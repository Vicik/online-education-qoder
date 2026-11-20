#!/usr/bin/env bash
# 知序课堂生产部署脚本（PM2 + PostgreSQL）
#
# 流程：预检 → 安装依赖 → 生成 Prisma Client → 构建 → 数据库备份 → 迁移 → 重启 PM2 → 健康检查
#
# 使用前提：
#   - 代码已更新到目标版本（git pull / 发布产物），脚本不负责拉代码
#   - 服务器已安装 node >= 24、npm、pm2、pg_dump（postgresql-client）、curl
#   - PM2 中已存在 API 与 Worker 两个应用（默认名 zhixu-api / zhixu-worker）
#   - 脚本在 backend 目录下的 scripts 目录执行，任意位置可用绝对路径调用
#
# 常用覆盖项（环境变量）：
#   APP_DIR            后端目录，默认脚本上一级
#   BACKUP_DIR         数据库备份目录，默认 ~/zhixu-db-backups
#   BACKUP_KEEP        保留最近 N 份备份，默认 7
#   BACKUP_DATABASE_URL  单独指定 pg_dump 连接串（默认复用 DATABASE_URL 并剔除 schema 参数）
#   PM2_API_APP        API 应用名，默认 zhixu-api；设为空字符串则跳过重启/健康检查
#   PM2_WORKER_APP     Worker 应用名，默认 zhixu-worker；设为空字符串则跳过重启
#   HEALTH_URL         存活检查地址，默认 http://127.0.0.1:3000/api/v1/healthz
#   READY_URL          就绪检查地址，默认 http://127.0.0.1:3000/api/v1/readyz
#   HEALTH_RETRIES     健康检查重试次数，默认 30
#   HEALTH_INTERVAL    健康检查间隔秒数，默认 2
#
# 回滚：使用配套脚本 scripts/rollback.sh（恢复数据库备份 / 回滚代码 / 两者组合）
#   bash scripts/rollback.sh --list                           # 列出可用备份
#   bash scripts/rollback.sh --backup latest                  # 数据库恢复到最新备份
#   bash scripts/rollback.sh --backup latest --ref <commit>   # 数据库与代码一起回滚
#   bash scripts/rollback.sh --ref <commit>                   # 仅回滚代码，不动数据库
#   说明：Prisma 没有 down 迁移，回滚方式是恢复备份（脚本会先对当前库做保护性快照）；
#         恢复会覆盖当前库，备份之后产生的新写入会丢失。代码若依赖新 schema，
#         必须用 --ref 一并回滚，否则 /readyz 不会报错但业务查询会失败。
#
# 破坏性 schema 变更（删列、改类型、收缩枚举）必须遵循 expand-contract：
#   本次发布只做兼容迁移，旧代码下线后再单独发删除迁移，否则迁移与重启之间旧进程会报错。
#
# 媒体文件不在本脚本备份范围内：UPLOAD_DIR 需单独挂持久卷并另行备份。

# 严格模式：任一命令失败立即退出，未定义变量报错，管道任一环节失败即失败
set -Eeuo pipefail

# 脚本所在目录（backend/scripts）
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# 后端应用目录：默认取脚本上一级
APP_DIR="${APP_DIR:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
# 数据库备份存放目录：默认放在部署用户 HOME 下，避免进入仓库
BACKUP_DIR="${BACKUP_DIR:-$HOME/zhixu-db-backups}"
# 备份保留份数：超出后删除最旧的
BACKUP_KEEP="${BACKUP_KEEP:-7}"
# 备份专用连接串：为空时由 build_backup_url 从 DATABASE_URL 派生
BACKUP_DATABASE_URL="${BACKUP_DATABASE_URL:-}"
# PM2 中 API 应用名：为空表示跳过重启与健康检查
PM2_API_APP="${PM2_API_APP:-zhixu-api}"
# PM2 中 Worker 应用名：为空表示跳过重启
PM2_WORKER_APP="${PM2_WORKER_APP:-zhixu-worker}"
# API 存活检查地址
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/v1/healthz}"
# API 就绪检查地址（会检查数据库与 Redis）
READY_URL="${READY_URL:-http://127.0.0.1:3000/api/v1/readyz}"
# 健康检查最大重试次数
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
# 健康检查间隔（秒）
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
# 部署互斥锁文件：防止两个部署并发执行
LOCK_FILE="${LOCK_FILE:-$HOME/.zhixu-deploy.lock}"
# 最近一次成功备份的路径：用于失败时提示恢复命令
LAST_BACKUP_FILE=""

# 输出带 UTC 时间戳的日志
log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$*"
}

# 输出错误并终止脚本
die() {
  printf '[%s] 错误：%s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$*" >&2
  exit 1
}

# 未预期失败时的收尾：打印失败命令、退出码与恢复提示（不做自动回滚）
on_error() {
  # 捕获的退出码
  local code=$?
  # 失败的命令文本（bash ERR 陷阱提供）
  local failed_command="$BASH_COMMAND"
  printf '[%s] 部署失败（退出码 %s）：%s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$code" "$failed_command" >&2
  if [[ -n "$LAST_BACKUP_FILE" ]]; then
    printf '[%s] 最近一次备份：%s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$LAST_BACKUP_FILE" >&2
    printf '[%s] 如需回滚数据库：先 pm2 stop 相关应用，再执行 pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" "%s"\n' \
      "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$LAST_BACKUP_FILE" >&2
  fi
  exit "$code"
}

trap on_error ERR

# 获取部署互斥锁：flock 可用时非阻塞加锁，不可用时仅告警
acquire_lock() {
  if command -v flock >/dev/null 2>&1; then
    # 文件描述符 9 持有锁直到脚本退出
    exec 9>"$LOCK_FILE"
    flock -n 9 || die "已有部署任务在执行（锁文件：$LOCK_FILE）"
  else
    log "警告：系统缺少 flock，跳过并发部署锁"
  fi
}

# 预检：必需命令、环境变量、目录与 PM2 应用
preflight() {
  # 逐个检查依赖命令
  local cmd
  for cmd in node npm npx pm2 pg_dump curl; do
    command -v "$cmd" >/dev/null 2>&1 || die "缺少命令：$cmd"
  done
  # 数据库连接串必须存在（Prisma 迁移与 pg_dump 都依赖）
  [[ -n "${DATABASE_URL:-}" ]] || die "未设置 DATABASE_URL 环境变量"
  # 应用目录必须存在且包含 schema
  [[ -d "$APP_DIR" ]] || die "应用目录不存在：$APP_DIR"
  [[ -f "$APP_DIR/prisma/schema.prisma" ]] || die "未找到 prisma/schema.prisma，检查 APP_DIR 是否正确"
  # 创建备份目录
  mkdir -p "$BACKUP_DIR"
}

# 校验 PM2 应用存在：应用名为空表示跳过，配置了但找不到则直接失败
check_pm2_app() {
  # 目标应用名
  local app="$1"
  [[ -z "$app" ]] && return 0
  pm2 describe "$app" >/dev/null 2>&1 || die "PM2 中找不到应用：$app（检查 PM2_API_APP / PM2_WORKER_APP）"
}

# 构造 pg_dump 连接串：libpq 不识别 Prisma 的 schema 参数，需要剔除；其余参数（如 sslmode）保留
build_backup_url() {
  # 显式提供的备份连接串优先
  if [[ -n "$BACKUP_DATABASE_URL" ]]; then
    printf '%s' "$BACKUP_DATABASE_URL"
    return 0
  fi
  # 原始连接串
  local url="$DATABASE_URL"
  # 没有查询参数时直接复用
  [[ "$url" != *\?* ]] && { printf '%s' "$url"; return 0; }
  # 基础部分（scheme://...）
  local base="${url%%\?*}"
  # 查询参数部分
  local query="${url#*\?}"
  # 过滤后保留的参数串
  local kept=""
  # 单个参数
  local param
  # 按 & 拆分参数；此处依赖词拆分，故不加引号
  local IFS='&'
  for param in $query; do
    # 丢弃空参数与 Prisma 专有的 schema 参数
    [[ -z "$param" || "$param" == schema=* ]] && continue
    kept="${kept:+$kept&}$param"
  done
  # 拼接回带参数（如有）的连接串
  printf '%s' "$base${kept:+?$kept}"
}

# 清理旧备份：按修改时间倒序，只保留最近 BACKUP_KEEP 份
prune_backups() {
  # 当前遍历到的序号
  local index=0
  # 备份文件路径
  local file
  while IFS= read -r file; do
    index=$((index + 1))
    if (( index > BACKUP_KEEP )); then
      log "删除旧备份：$file"
      rm -f -- "$file"
    fi
    # 按修改时间倒序列出备份文件；cut 保留含空格的完整路径
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'zhixu_*.dump' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
}

# 备份数据库：custom 格式，先写 .partial 再改名，避免留下不完整备份
backup_database() {
  # UTC 时间戳：文件名排序即时间顺序
  local stamp
  stamp="$(date -u '+%Y%m%d_%H%M%S')"
  # 最终备份文件
  local file="$BACKUP_DIR/zhixu_${stamp}.dump"
  # 写入中的临时文件
  local tmp="${file}.partial"
  # 备份使用的连接串
  local url
  url="$(build_backup_url)"
  log "开始备份数据库：$file"
  # custom 格式支持压缩与 pg_restore 选择性恢复；去掉属主/权限便于跨环境恢复
  if ! pg_dump --format=custom --no-owner --no-privileges --dbname "$url" --file "$tmp"; then
    rm -f -- "$tmp"
    die "pg_dump 备份失败，已中止部署（数据库未被迁移）"
  fi
  # 空文件视为失败
  [[ -s "$tmp" ]] || { rm -f -- "$tmp"; die "备份文件为空：$tmp"; }
  # 原子改名，保证正式备份文件一定有完整内容
  mv -- "$tmp" "$file"
  # 记录本次备份路径，供失败提示与收尾日志使用
  LAST_BACKUP_FILE="$file"
  log "备份完成：$file（$(du -h -- "$file" | cut -f1)）"
  prune_backups
}

# 用 pm2 jlist 的 JSON 精确判断应用是否 online，避免解析文本表格
pm2_online() {
  # 目标应用名
  local app="$1"
  pm2 jlist 2>/dev/null | node -e '
    // 累积 stdin 内容
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      try {
        // 解析 PM2 进程列表
        const list = JSON.parse(raw || "[]");
        // 按名称查找目标应用
        const item = list.find((p) => p.name === process.argv[1]);
        // 仅 online 状态视为正常
        process.exit(item && item.pm2_env && item.pm2_env.status === "online" ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  ' "$app"
}

# 等待 PM2 应用恢复 online 状态
wait_pm2_online() {
  # 目标应用名
  local app="$1"
  # 当前尝试次数
  local attempt=1
  while (( attempt <= HEALTH_RETRIES )); do
    pm2_online "$app" && return 0
    sleep "$HEALTH_INTERVAL"
    attempt=$((attempt + 1))
  done
  return 1
}

# 轮询 API 健康检查：healthz 恒 200，readyz 依赖数据库与 Redis
wait_healthy() {
  # 当前尝试次数
  local attempt=1
  log "等待 API 就绪：$READY_URL"
  while (( attempt <= HEALTH_RETRIES )); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1 &&
      curl -fsS --max-time 5 "$READY_URL" >/dev/null 2>&1; then
      log "健康检查通过：$READY_URL"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
    attempt=$((attempt + 1))
  done
  die "健康检查超时（${HEALTH_RETRIES} 次 × ${HEALTH_INTERVAL}s）：$READY_URL，请执行 pm2 logs $PM2_API_APP 排查"
}

# 主流程
main() {
  acquire_lock
  preflight
  check_pm2_app "$PM2_API_APP"
  check_pm2_app "$PM2_WORKER_APP"

  # 部署版本号：git 目录取 commit，否则记 unknown
  local revision="unknown"
  if git -C "$APP_DIR" rev-parse --short HEAD >/dev/null 2>&1; then
    revision="$(git -C "$APP_DIR" rev-parse --short HEAD)"
  fi
  log "开始部署：目录=$APP_DIR 版本=$revision"

  cd "$APP_DIR"

  log "安装依赖：npm ci"
  # --include=dev：即使 NODE_ENV=production 也要装构建所需的 nest/prisma/ts 依赖
  npm ci --include=dev --no-audit --no-fund

  log "生成 Prisma Client"
  npx prisma generate

  log "构建后端：npm run build"
  npm run build

  # 构建产物必须包含 API 与 Worker 入口，缺失时重启只会得到崩溃循环
  [[ -f "$APP_DIR/dist/src/main.js" ]] || die "构建产物缺少 dist/src/main.js"
  [[ -f "$APP_DIR/dist/src/worker.js" ]] || die "构建产物缺少 dist/src/worker.js"

  # 备份放在构建之后、迁移之前：构建失败不会污染备份目录
  backup_database

  log "应用数据库迁移：prisma migrate deploy"
  npx prisma migrate deploy

  log "校验迁移状态"
  # 迁移后仍有 pending/failed 或检测到 drift 时以非零退出，中止部署
  npx prisma migrate status

  # 先重启 Worker 再重启 API：迁移后两端都用新 schema，API 对外窗口最短
  if [[ -n "$PM2_WORKER_APP" ]]; then
    log "重启 Worker：$PM2_WORKER_APP"
    pm2 restart "$PM2_WORKER_APP" --update-env
    wait_pm2_online "$PM2_WORKER_APP" || die "Worker 未能恢复 online：$PM2_WORKER_APP，请执行 pm2 logs $PM2_WORKER_APP"
    log "Worker 已恢复 online"
  fi

  if [[ -n "$PM2_API_APP" ]]; then
    log "重启 API：$PM2_API_APP"
    pm2 restart "$PM2_API_APP" --update-env
    wait_healthy
  else
    log "跳过健康检查：未配置 PM2_API_APP"
  fi

  log "部署完成：版本=$revision 备份=$LAST_BACKUP_FILE"
}

# 直接执行时运行主流程；被其他脚本 source 时只提供公共函数
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
