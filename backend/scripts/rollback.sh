#!/usr/bin/env bash
# 知序课堂生产回滚脚本（PM2 + PostgreSQL）
#
# 两种回滚维度，可单独或组合使用：
#   --backup  恢复数据库备份：先对当前库做保护性快照，再清空 public schema 并 pg_restore
#   --ref     回滚代码：git 切换到指定版本后 npm ci / prisma generate / build
# 恢复数据库时会先停 PM2 应用，完成后重启并做健康检查。
#
# 使用：
#   bash scripts/rollback.sh --list                           # 列出可用备份
#   bash scripts/rollback.sh --backup latest                  # 恢复到最新备份
#   bash scripts/rollback.sh --backup latest --ref <commit>   # 数据库与代码一起回滚
#   bash scripts/rollback.sh --ref <commit>                   # 仅回滚代码，不动数据库
#
# 重要说明：
#   - Prisma 没有 down 迁移，本脚本通过恢复备份回滚，不逐条反向执行迁移
#   - 恢复会清空 public schema，备份之后的所有数据写入都会丢失
#   - 恢复前会自动对当前库再做一次快照（latest 时同样先快照再覆盖），回滚本身可再还原
#   - /readyz 只校验数据库与 Redis 连通性，不校验代码与 schema 是否匹配；
#     若本次发布包含破坏性 schema 变更，请务必同时用 --ref 回滚代码
#   - 恢复数据库需要 psql（postgresql-client），且 DATABASE_URL 用户需有 schema 属主权限
#   - 媒体文件不在备份范围内：UPLOAD_DIR 需单独挂持久卷并另行备份
#
# 环境变量与部署脚本一致：APP_DIR / BACKUP_DIR / BACKUP_KEEP / DATABASE_URL /
# PM2_API_APP / PM2_WORKER_APP / HEALTH_URL / READY_URL / HEALTH_RETRIES / HEALTH_INTERVAL

# 严格模式：任一命令失败立即退出，未定义变量报错，管道任一环节失败即失败
set -Eeuo pipefail

# 脚本所在目录（backend/scripts）
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# 复用部署脚本的公共函数（日志、参数校验、备份、PM2 状态、健康检查）；source 时不会执行部署主流程
# shellcheck source=deploy.sh
source "$SCRIPT_DIR/deploy.sh"

# --backup 参数：备份文件路径或 latest（空=不回滚数据库）
BACKUP_ARG=""
# --ref 参数：代码回滚目标 git ref（空=不回滚代码）
CODE_REF=""
# 是否跳过交互确认
ASSUME_YES=0
# 是否只列出备份
LIST_ONLY=0
# 回滚前的代码版本（用于确认提示与收尾摘要）
BEFORE_REV="unknown"
# 回滚前对当前库生成的保护性快照路径
PRE_ROLLBACK_SNAPSHOT=""

# 打印用法与注意事项
usage() {
  cat <<'EOF'
用法：bash scripts/rollback.sh [选项]

选项：
  --backup <文件|latest>  要恢复的数据库备份；latest 取备份目录中最新一份
  --ref <git-ref>         同时把代码切到指定版本并重新构建
  --list                  列出可用备份后退出
  --yes                   跳过输入 ROLLBACK 的交互确认
  -h, --help              显示本帮助

示例：
  bash scripts/rollback.sh --list
  bash scripts/rollback.sh --backup latest
  bash scripts/rollback.sh --backup latest --ref <commit>
  bash scripts/rollback.sh --ref <commit>          # 仅回滚代码，不动数据库
EOF
}

# 列出备份目录中的备份（最新在前）
list_backups() {
  # 是否至少找到一份备份
  local found=0
  # 循环中的单行输出
  local line
  while IFS= read -r line; do
    found=1
    printf '%s\n' "$line"
    # 按修改时间倒序输出：日期、时间、字节约、完整路径
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'zhixu_*.dump' -printf '%TY-%Tm-%Td %TH:%TM %10s  %p\n' 2>/dev/null | sort -r)
  (( found == 1 )) || printf '备份目录中没有备份：%s\n' "$BACKUP_DIR"
}

# 解析备份参数：latest 解析为最新的备份路径，其余原样返回
resolve_backup_file() {
  # 用户传入的参数
  local arg="$1"
  # latest 解析出的最新备份路径
  local newest=""
  if [[ "$arg" == "latest" ]]; then
    newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'zhixu_*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2-)"
    [[ -n "$newest" ]] || die "备份目录中没有可用备份：$BACKUP_DIR"
    printf '%s' "$newest"
    return 0
  fi
  printf '%s' "$arg"
}

# 交互确认：展示回滚计划并要求输入 ROLLBACK
confirm_or_abort() {
  # 待恢复的备份文件（空=不回滚数据库）
  local backup_file="$1"
  # 目标代码版本（空=不回滚代码）
  local target_commit="$2"
  # --yes 直接放行
  if (( ASSUME_YES == 1 )); then
    return 0
  fi
  # 非交互环境（脚本/管道）必须显式 --yes，避免自动化误触
  if [[ ! -t 0 ]]; then
    die '非交互环境必须显式传 --yes'
  fi
  printf '\n即将执行回滚：\n'
  if [[ -n "$backup_file" ]]; then
    printf '  - 数据库：清空 public schema 并恢复到 %s\n' "$backup_file"
    printf '  - 警告：该备份之后产生的所有数据写入都会丢失\n'
  fi
  if [[ -n "$target_commit" ]]; then
    printf '  - 代码：从 %s 切换到 %s 并重新构建\n' "$BEFORE_REV" "$target_commit"
  fi
  printf '输入 ROLLBACK 确认，其他任何输入取消：'
  # 用户输入内容
  local answer=""
  IFS= read -r answer
  [[ "$answer" == "ROLLBACK" ]] || die '已取消'
}

# 回滚代码：校验工作区干净后切换版本、安装依赖、重新生成并构建
rollback_code() {
  # 目标 git ref
  local ref="$1"
  # 工作区状态输出（非空表示有未提交改动）
  local dirty
  dirty="$(git -C "$APP_DIR" status --porcelain)"
  [[ -z "$dirty" ]] || die '工作区存在未提交修改，禁止切换代码版本（先处理 git status 输出）'
  # 解析后的目标 commit
  local target
  target="$(git -C "$APP_DIR" rev-parse --verify "${ref}^{commit}")" || die "无法解析 git ref：$ref"
  log "切换代码：$ref（$target）"
  git -C "$APP_DIR" checkout "$target"
  cd "$APP_DIR"
  log '安装依赖：npm ci'
  # --include=dev：即使 NODE_ENV=production 也要装构建所需的 nest/prisma/ts 依赖
  npm ci --include=dev --no-audit --no-fund
  log '生成 Prisma Client'
  npx prisma generate
  log '构建后端：npm run build'
  npm run build
  # 构建产物校验：缺失入口会导致重启后崩溃循环
  [[ -f "$APP_DIR/dist/src/main.js" ]] || die '构建产物缺少 dist/src/main.js'
  [[ -f "$APP_DIR/dist/src/worker.js" ]] || die '构建产物缺少 dist/src/worker.js'
}

# 恢复数据库：保护性快照 → 停应用 → 清空 public schema → pg_restore
restore_database() {
  # 待恢复的备份文件
  local backup_file="$1"
  # 连接串（剔除 Prisma 专有的 schema 参数）
  local url
  url="$(build_backup_url)"
  log '回滚前快照当前数据库（防止回滚本身出错时无法还原）'
  # 快照期间临时放大保留份数，避免清理策略误删待恢复的旧备份
  local saved_keep="$BACKUP_KEEP"
  BACKUP_KEEP=9999
  backup_database
  BACKUP_KEEP="$saved_keep"
  # 本次保护性快照的路径（backup_database 会写入 LAST_BACKUP_FILE）
  PRE_ROLLBACK_SNAPSHOT="$LAST_BACKUP_FILE"

  if [[ -n "$PM2_WORKER_APP" ]]; then
    log "停止 Worker：$PM2_WORKER_APP"
    pm2 stop "$PM2_WORKER_APP"
  fi
  if [[ -n "$PM2_API_APP" ]]; then
    log "停止 API：$PM2_API_APP"
    pm2 stop "$PM2_API_APP"
  fi

  log '清空 public schema'
  # 直接重建 schema 而不是 pg_restore --clean：后者不会删除备份中不存在的新表
  psql --dbname "$url" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
  log "恢复备份：$backup_file"
  # --single-transaction：恢复失败整体回滚，避免半恢复状态
  pg_restore --no-owner --no-privileges --single-transaction --dbname "$url" "$backup_file"
  log '数据库恢复完成'
  # 待恢复文件已使用，恢复正常保留策略并清理
  prune_backups
}

# 重启应用并验证：Worker 需恢复 online，API 需通过 healthz/readyz
restart_apps() {
  if [[ -n "$PM2_WORKER_APP" ]]; then
    log "重启 Worker：$PM2_WORKER_APP"
    pm2 restart "$PM2_WORKER_APP" --update-env
    wait_pm2_online "$PM2_WORKER_APP" || die "Worker 未能恢复 online：$PM2_WORKER_APP，请执行 pm2 logs $PM2_WORKER_APP"
    log 'Worker 已恢复 online'
  fi
  if [[ -n "$PM2_API_APP" ]]; then
    log "重启 API：$PM2_API_APP"
    pm2 restart "$PM2_API_APP" --update-env
    wait_healthy
  else
    log '跳过健康检查：未配置 PM2_API_APP'
  fi
}

# 主流程：解析参数 → 预检 → 计划确认 → 执行回滚
run() {
  # 逐个解析命令行参数
  while (( $# > 0 )); do
    case "$1" in
      --backup)
        [[ $# -ge 2 ]] || die '--backup 需要一个参数'
        BACKUP_ARG="$2"
        shift 2
        ;;
      --ref)
        [[ $# -ge 2 ]] || die '--ref 需要一个参数'
        CODE_REF="$2"
        shift 2
        ;;
      --list)
        LIST_ONLY=1
        shift
        ;;
      --yes)
        ASSUME_YES=1
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        die "未知参数：$1（--help 查看用法）"
        ;;
    esac
  done

  # 仅列出备份时不需要数据库连接与应用环境
  if (( LIST_ONLY == 1 )); then
    list_backups
    return 0
  fi

  # 至少需要一个回滚维度
  if [[ -z "$BACKUP_ARG" && -z "$CODE_REF" ]]; then
    usage
    die '至少指定 --backup 或 --ref'
  fi

  acquire_lock
  preflight
  # 恢复数据库依赖 psql（部署脚本的预检只检查 pg_dump）
  if [[ -n "$BACKUP_ARG" ]]; then
    command -v psql >/dev/null 2>&1 || die '缺少命令：psql'
  fi
  check_pm2_app "$PM2_API_APP"
  check_pm2_app "$PM2_WORKER_APP"

  # 记录当前代码版本，用于确认提示与收尾摘要
  if git -C "$APP_DIR" rev-parse --short HEAD >/dev/null 2>&1; then
    BEFORE_REV="$(git -C "$APP_DIR" rev-parse --short HEAD)"
  fi

  # 解析并校验备份文件
  local backup_file=""
  if [[ -n "$BACKUP_ARG" ]]; then
    backup_file="$(resolve_backup_file "$BACKUP_ARG")"
    [[ -f "$backup_file" ]] || die "备份文件不存在：$backup_file"
    [[ -s "$backup_file" ]] || die "备份文件为空：$backup_file"
  fi

  # 解析并校验目标 commit
  local target_commit=""
  if [[ -n "$CODE_REF" ]]; then
    target_commit="$(git -C "$APP_DIR" rev-parse --short "${CODE_REF}^{commit}")" || die "无法解析 git ref：$CODE_REF"
  fi

  confirm_or_abort "$backup_file" "$target_commit"

  # 先回滚代码（构建失败时数据库尚未改动，影响最小），再恢复数据库
  if [[ -n "$CODE_REF" ]]; then
    rollback_code "$CODE_REF"
  fi
  if [[ -n "$backup_file" ]]; then
    restore_database "$backup_file"
  fi

  restart_apps

  log "回滚完成：备份=${backup_file:-未使用} 代码=${target_commit:-未变更} 回滚前快照=${PRE_ROLLBACK_SNAPSHOT:-无}"
  if [[ -n "$backup_file" && -z "$CODE_REF" ]]; then
    log '提示：数据库已回到备份时点但代码未变更；若当前代码依赖新 schema，请用 --ref 追加回滚代码'
  fi
}

run "$@"
