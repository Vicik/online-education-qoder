# 本地文件与媒体上传设计

> 日期：2026-11-12 · 状态：待评审 · 适用范围：图片、音频、视频上传与播放
>
> 本文替代 [backend/实施计划/13-文件上传与对象存储.md](../../../backend/实施计划/13-文件上传与对象存储.md) 中的 MinIO 私有桶方案，并覆盖 [backend/接口设计文档.md](../../../backend/接口设计文档.md) 决策点 D9 在本功能范围内的结论。历史文档保留为决策记录。

## 1. 背景与目标

当前图片上传链路为：`POST /api/v1/files/upload` → multer 内存缓冲 → magic bytes/MIME 校验 → sharp 重编码去 EXIF → 写入 MinIO 私有桶 → 返回 `{ key, url }`（1 小时签名地址）。数据库保存 key，读取时由 `StorageService.resolveUrl` / `signRichHtml` 临时签名。

新的目标是：

1. 文件保存在本地磁盘的 `uploadFiles` 目录下，按 `类型/年/月/日` 分层。
2. 上传成功后返回可直接用于页面展示的地址。
3. 后续支持音频、视频上传，并与现有课程章节（`video` / `audio`）打通。
4. 去掉运行时的 MinIO/S3 依赖，降低部署与开发成本。

## 2. 非目标（一期不做）

- 视频转码、HLS 切片、多码率自适应、DRM。
- 断点续传、分片上传、秒传。
- 公开用户上传音视频；一期音视频仅管理员可传。
- 对象存储/CDN 迁移、跨机房容灾。
- 孤儿文件自动回收任务（仅提供启动时临时文件清理）。
- 防盗链之外的强版权保护。

## 3. 现状与约束

| 项 | 现状 |
| --- | --- |
| 图片上传 | `POST /api/v1/files/upload`，登录用户，≤2MB，PNG/JPEG/WebP，sharp 重编码 |
| 章节媒体 | `Chapter.content` 保存“对象存储 key”，管理端目前用文本输入框手填 |
| 读取 | `resolveUrl` 对 key 生成签名 URL；富文本图片由 `signRichHtml` 重写 `src` |
| 存储 | MinIO 私有桶，S3 SDK + presign；CI 集成测试依赖 testcontainers MinIO |
| 部署 | 单机 NestJS + PostgreSQL + Redis；Nginx 负责 TLS/限流/体积限制 |

设计前提：

- 单实例部署，`UPLOAD_DIR` 挂载持久卷，纳入备份。
- 图片允许公开访问；课程音视频属于付费内容，必须受保护。
- 一期不做转码，管理员需上传浏览器可直接播放的格式。
- 当前仓库没有生产存量数据；本地 MinIO 数据以清库重播种子为准。若部署环境确有存量，另行执行第 12 节迁移。

## 4. 关键决策

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D1 | 存储后端 | 本地磁盘，去掉运行时 S3/MinIO 依赖 |
| D2 | 目录结构 | `类型/年/月/日/UUID.扩展名`，按 UTC 日期分目录 |
| D3 | 数据库存什么 | 只存相对 key，不存完整 URL |
| D4 | 图片访问 | 公开静态 URL，长期缓存 |
| D5 | 音视频访问 | 短期签名 URL + 流式读取/Range，不公开静态目录 |
| D6 | 上传角色 | 图片：登录用户；音视频：仅管理员 |
| D7 | 上传缓冲 | 图片 2MB 内存缓冲；音视频流式落临时文件，禁止整文件进内存 |
| D8 | 格式策略 | 图片 PNG/JPEG/WebP；视频 MP4/WebM；音频 M4A/MP3 |
| D9 | 转码 | 一期不转码，要求上传浏览器兼容格式 |
| D10 | 部署形态 | 单实例 + 持久卷；多实例需改共享存储或对象存储 |
| D11 | 旧数据 | 无生产存量时清库重播；有存量时单独迁移，不做运行时双写 |

## 5. 总体架构

```text
管理端 / 用户端
    │
    ├─ 图片上传 POST /api/v1/files/upload ─────────────┐
    │                                                   ▼
    │                                        StorageService
    │                                     校验 → 重编码/检测
    │                                     写 public/image/...
    │                                                   │
    ├─ 音视频上传 POST /api/v1/admin/files/{video|audio}┘
    │                                       流式写 tmp → 校验 → 移动到
    │                                       protected/{video|audio}/...
    │
    ├─ 图片展示 GET /uploadFiles/image/...
    │       └─ Nest static（开发）/ Nginx alias（生产）
    │
    └─ 音视频播放 GET /api/v1/files/media?key=&exp=&sig=
            └─ 验签 → res.sendFile（开发）
                    或 X-Accel-Redirect → Nginx（生产）
```

### 5.1 图片上传数据流

1. 客户端 `multipart/form-data` 上传 `file`。
2. 控制器使用 multer 内存缓冲，限制 2MB。
3. `StorageService.uploadImage` 校验体积、`Content-Type`、magic bytes。
4. sharp `rotate()` 重编码，按类型输出 PNG/JPEG/WebP，去除元数据。
5. 生成 key：`image/YYYY/MM/DD/<uuid>.<png|jpg|webp>`。
6. 写入 `UPLOAD_DIR/public/<key>`（先写 tmp 再 rename）。
7. 返回 `{ key, url }`，`url = ${PUBLIC_BASE_URL}/uploadFiles/${key}`。

### 5.2 音视频上传数据流

1. 管理员请求 `POST /api/v1/admin/files/video` 或 `/audio`。
2. multer `diskStorage` 把文件流式写入 `UPLOAD_DIR/tmp/<uuid>.part`，上限取视频上限。
3. 服务读取文件头 64KB，识别容器类型，校验与接口类型一致、体积不超过该类型上限。
4. 生成 key：`video|audio/YYYY/MM/DD/<uuid>.<ext>`。
5. `mkdir` 目标目录后 `rename` 临时文件到 `UPLOAD_DIR/protected/<key>`。
6. 返回 `{ key, url, mimeType, size }`，`url` 为短期签名播放地址，供管理端即时预览。
7. 任何校验失败或请求中断都删除临时文件；启动时清理超过 24 小时的 tmp 文件。

### 5.3 播放数据流

1. 学员请求章节内容，`CourseService` 先做购买校验。
2. `StorageService.resolveUrl(contentKey)` 对音视频 key 生成签名 URL。
3. 前端 `<video>` / `<audio>` 请求签名 URL。
4. `MediaController` 校验 `key/exp/sig`，确认文件存在后返回内容。
5. 播放器拖动进度条时发送 `Range` 请求，返回 `206 Partial Content`。

## 6. 存储布局与 key 规则

### 6.1 目录

```text
UPLOAD_DIR/
  public/
    image/2026/11/12/6f1c....png
  protected/
    video/2026/11/12/9a2e....mp4
    audio/2026/11/12/3b7d....m4a
  tmp/
    4c8f....part
```

### 6.2 key 规则

| 类型 | key 示例 | 落盘位置 | 访问方式 |
| --- | --- | --- | --- |
| 图片 | `image/2026/11/12/<uuid>.webp` | `UPLOAD_DIR/public/<key>` | `${PUBLIC_BASE_URL}/uploadFiles/<key>` |
| 视频 | `video/2026/11/12/<uuid>.mp4` | `UPLOAD_DIR/protected/<key>` | 签名 URL |
| 音频 | `audio/2026/11/12/<uuid>.m4a` | `UPLOAD_DIR/protected/<key>` | 签名 URL |

约束：

- 文件名一律使用服务端 `randomUUID()`，不使用原始文件名。
- 日期使用 UTC，与数据库时间口径一致。
- key 只能由服务端生成；客户端提交的 key 必须匹配白名单正则。
- `Chapter.content`、`User.avatarUrl`、`Course.coverUrl`、富文本 `data-key` 继续保存 key。
- 旧 MinIO key（`zhixu/...`、`videos/...`）不做运行时兼容，迁移/重播后必须改为新格式。

## 7. 接口契约

### 7.1 角色权限

| 接口 | 游客 | 普通用户 | 管理员 |
| --- | --- | --- | --- |
| `POST /api/v1/files/upload` | 401 | ✔ | ✔ |
| `POST /api/v1/admin/files/video` | 401 | 403 | ✔ |
| `POST /api/v1/admin/files/audio` | 401 | 403 | ✔ |
| `GET /api/v1/files/media` | ✔（仅持有效签名 URL） | ✔（仅持有效签名 URL） | ✔ |
| `GET /uploadFiles/image/...` | ✔ | ✔ | ✔ |

### 7.2 图片上传

`POST /api/v1/files/upload`，`multipart/form-data`，字段 `file`。

成功 `201`：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "key": "image/2026/11/12/6f1c....png",
    "url": "http://localhost:3000/uploadFiles/image/2026/11/12/6f1c....png"
  },
  "requestId": "..."
}
```

错误：

| 场景 | HTTP | code |
| --- | --- | --- |
| 未登录 | 401 | 2001 |
| 未选文件 | 400 | 1001 |
| 超过 2MB | 422 | 1001 |
| 类型不支持或内容与类型不符 | 422 | 1001 |

### 7.3 音视频上传

`POST /api/v1/admin/files/video`、`POST /api/v1/admin/files/audio`，`multipart/form-data`，字段 `file`。

成功 `201`：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "key": "video/2026/11/12/9a2e....mp4",
    "url": "http://localhost:3000/api/v1/files/media?key=video%2F2026%2F11%2F12%2F9a2e....mp4&exp=1760000000&sig=...",
    "mimeType": "video/mp4",
    "size": 104857600
  },
  "requestId": "..."
}
```

错误：

| 场景 | HTTP | code |
| --- | --- | --- |
| 未登录 | 401 | 2001 |
| 非管理员 | 403 | 2002 |
| 未选文件 | 400 | 1001 |
| 超过该类型上限 | 422 | 1001 |
| 容器类型与接口不符 | 422 | 1001 |
| 格式不支持 | 422 | 1001 |

### 7.4 媒体读取

`GET /api/v1/files/media?key=<urlencoded>&exp=<unix-seconds>&sig=<base64url>`。

- 公开接口（`@Public`），签名即授权；不要求登录会话。
- 成功返回文件内容；支持 `Range`，可返回 `206`。
- 签名无效、篡改、过期：`403`，code `2002`。
- key 合法但文件不存在：`404`，code `1002`。

### 7.5 章节内容返回

`ChapterContent.content`：

- `rich`：净化后的 HTML，图片 `src` 已重写为公开 URL，`data-key` 保留。
- `video` / `audio`：短期签名播放地址。
- 本章节未上传内容：`null`。

## 8. 安全设计

### 8.1 上传校验

- 图片：magic bytes + 声明的 MIME 一致性 + sharp 可解码 + 2MB 上限。
- 音视频：读取文件头识别容器，与接口类型匹配；体积不超过配置上限。
- 不接受原始文件名，不使用客户端扩展名决定落盘路径。
- 音视频只允许 `video/mp4`、`video/webm`、`audio/mp4`、`audio/mpeg` 对应的容器；不允许 SVG、HTML、可执行文件。
- 一期不引入 ffprobe；编码兼容性由上传规范约束（见 10.3）。

### 8.2 路径安全

- key 只由服务端生成，格式白名单：
  - 图片：`^image/\d{4}/\d{2}/\d{2}/[0-9a-f-]{36}\.(png|jpg|webp)$`
  - 媒体：`^(video|audio)/\d{4}/\d{2}/\d{2}/[0-9a-f-]{36}\.(mp4|webm|m4a|mp3)$`
- 读取时 `path.resolve` 后再次校验目标路径位于 `UPLOAD_DIR/protected` 之下，防止路径穿越。
- 静态目录关闭目录列表（Nginx `autoindex off`；Express static 默认不列目录）。

### 8.3 访问控制

- 图片公开：适合头像、封面、富文本插图；URL 泄露不影响核心资产。
- 音视频受保护：URL 由 HMAC-SHA256 签名，默认 4 小时有效；签名覆盖 `key + exp`。
- 签名校验使用 `crypto.timingSafeEqual`，长度不一致直接拒绝。
- 签名 URL 在有效期内仍可被转发，不能替代 DRM；媒体页面建议 `Referrer-Policy: no-referrer`。
- 播放响应设置 `Cache-Control: private, max-age=0, must-revalidate`，避免共享缓存长期保存付费内容。
- 公开图片设置 `Cache-Control: public, max-age=31536000, immutable`；UUID 文件不可变，适合长缓存。

### 8.4 响应头

- 静态图片与媒体：`X-Content-Type-Options: nosniff`。
- 媒体：`Content-Type` 由服务端按扩展名设置，`Content-Disposition: inline`。
- 如前端启用 CSP，需要把 `PUBLIC_BASE_URL` 加入 `img-src`、`media-src`。

### 8.5 DoS 与容量

- 图片 2MB；音频默认 100MB；视频默认 1GB，均可通过环境变量调整。
- Nginx 与应用双重限制；音视频接口仅管理员可用。
- 上传失败/中断清理临时文件；启动时清理超过 24 小时的 tmp。
- 需要磁盘容量监控与告警；一期不做单用户配额。

## 9. 前端设计

### 9.1 图片

- `ImageUploader`、`RichTextEditor` 继续调用 `uploadImage`，返回契约不变。
- 图片预览直接使用返回的公开 URL。
- 富文本保存时继续把 `src` 回写为 `data-key`，读取时由服务端重写为公开 URL。

### 9.2 音视频

新增 `MediaUploader` 组件：

- 入参：`kind: 'video' | 'audio'`、`value?: string | null`（key）、`onChange`、`disabled`。
- 上传前校验类型与大小；上传中显示进度；支持取消。
- 上传成功后保存 key，并用返回的签名 URL 即时预览。
- 视频使用 `<video controls>`，音频使用 `<audio controls>`。
- 管理端章节弹窗用它替换原“媒体 key”文本输入框。
- 编辑已有章节时，由于管理端章节列表不返回正文，组件显示“留空保持原内容不变”，不展示旧媒体预览。

### 9.3 播放

`ChapterViewer` 继续使用 `content.content` 作为 `src`；服务端已把 key 换成签名播放地址，前端无需感知存储细节。建议视频增加 `preload="metadata"`，避免首屏加载完整文件。

### 9.4 前端校验常量

在 `frontend/src/lib/validators.ts` 中维护与后端默认值一致的上限：

- 图片 2MB。
- 音频 100MB。
- 视频 1GB。
- 视频：`video/mp4`、`video/webm`。
- 音频：`audio/mpeg`、`audio/mp4`、`.mp3`、`.m4a`。

前端校验仅用于提升体验，服务端校验是最终门槛。

## 10. 配置

### 10.1 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | 生成图片/媒体 URL 的公开源；末尾斜杠自动去除 |
| `UPLOAD_DIR` | `<进程工作目录>/uploadFiles` | 上传根目录；生产必须挂载持久卷 |
| `UPLOAD_SIGNING_SECRET` | `SESSION_SECRET` | 媒体 URL 签名密钥；生产建议单独设置 |
| `UPLOAD_AUDIO_MAX_MB` | `100` | 音频单文件上限（MB） |
| `UPLOAD_VIDEO_MAX_MB` | `1024` | 视频单文件上限（MB） |
| `UPLOAD_MEDIA_TTL_SECONDS` | `14400` | 媒体签名 URL 有效期（秒，默认 4 小时） |
| `UPLOAD_X_ACCEL_PREFIX` | 空 | 设置后使用 Nginx `X-Accel-Redirect`，如 `/_protected_media/` |

移除：`MINIO_ENDPOINT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`、`MINIO_PUBLIC_URL`、`MINIO_PRESIGN_TTL_SECONDS`。

### 10.2 图片上限

图片固定 2MB，与现有产品约束一致，不随环境变量调整。

### 10.3 媒体格式与编码要求

| 类型 | 允许容器 | 推荐编码 | 说明 |
| --- | --- | --- | --- |
| 视频 | MP4、WebM | H.264 + AAC（MP4）；VP9/Opus（WebM） | MP4 需 `moov` 前置（faststart），否则首帧等待久 |
| 音频 | M4A、MP3 | AAC（M4A）；MP3 | 浏览器原生播放 |

不接受 MKV、AVI、HEVC、AC3 等兼容性差的格式；一期不转码，也不做 faststart 自动修复。

## 11. 部署与运维

### 11.1 Nginx

```nginx
# 上传体积与超时
client_max_body_size 1024m;
proxy_request_buffering off;
proxy_read_timeout 600s;

# 公开图片
location /uploadFiles/ {
    alias /data/uploadFiles/public/;
    autoindex off;
    add_header Cache-Control "public, max-age=31536000, immutable";
    add_header X-Content-Type-Options nosniff;
}

# 受保护媒体：仅允许内部 X-Accel-Redirect 访问
location /_protected_media/ {
    internal;
    alias /data/uploadFiles/protected/;
    add_header X-Content-Type-Options nosniff;
}
```

- `UPLOAD_X_ACCEL_PREFIX=/_protected_media/` 时，Nest 只做验签并返回 `X-Accel-Redirect`，由 Nginx 负责 Range 与文件传输。
- 未设置时，Nest 使用 `res.sendFile`，适合开发和小流量环境。
- Nginx 的 `client_max_body_size` 必须不小于视频上限，否则会出现“本地能传、线上 413”。

### 11.2 持久化与备份

- `UPLOAD_DIR` 必须挂载持久卷；容器重建不能丢文件。
- 每日增量备份 `UPLOAD_DIR`（rsync/rclone 到另一块盘或对象存储），定期做恢复演练。
- 监控磁盘使用率、inode、上传失败率、tmp 目录大小。
- 容量预估：1080p 视频约 1.8–3.6GB/小时；100 小时课程约 200–350GB，备份需额外一倍空间。

### 11.3 单实例约束

本地盘方案不支持无状态横向扩容。需要多实例时：

- 使用共享卷（NFS/云盘）并确认并发写与锁语义；或
- 音视频迁移到对象存储，图片可继续本地；
- 不做多实例双写本地盘。

## 12. 迁移与种子数据

### 12.1 无存量数据（默认）

- 清空/重建数据库并重播种子。
- 种子中的视频章节 `content` 置空，避免指向不存在的 `videos/ch1.mp4`。
- 旧 MinIO 数据不再使用。

### 12.2 有存量数据

单独执行迁移，不纳入一期代码：

1. 使用 `mc mirror` 或 S3 SDK 把 MinIO 对象导出到临时目录。
2. 按对象 `LastModified` 生成 `类型/年/月/日/UUID.扩展名` 新 key，写入 `public/` 或 `protected/`。
3. 批量更新数据库：
   - `User.avatarUrl`、`Course.coverUrl`；
   - `Chapter.content`（video/audio）；
   - 富文本 `data-key`（`Course.detailRich`、`Chapter.content`、`Post.content`、`Comment.content`）。
4. 抽样验证图片可访问、视频可播放、签名 URL 可拖动进度。
5. 迁移完成前不要删除 MinIO 数据。

### 12.3 兼容策略

不做运行时 MinIO 回退。新代码只识别 `image/`、`video/`、`audio/` 前缀；旧 key 视为无效并返回 `null`（章节显示空状态），避免把异常内容透传给前端。

## 13. 测试策略

### 13.1 单元测试

- 配置：默认值、环境变量覆盖、末尾斜杠规范化。
- 媒体容器识别：MP4/M4A/MP3/WebM、伪造扩展名、类型不匹配。
- 存储服务：目录创建、图片落盘路径、公开 URL、媒体签名与验签、过期签名、路径穿越拒绝、tmp 清理。
- 富文本：`data-key` 重写为公开 URL，HTTP 历史地址原样保留。
- 前端：媒体类型/大小校验。

### 13.2 集成测试（CI）

移除 testcontainers MinIO，使用临时 `UPLOAD_DIR`：

- 图片上传成功 → 文件存在 → 公开 URL 200。
- 音视频上传成功 → 返回 key/签名 URL/MIME/size。
- 签名 URL GET 200；`Range: bytes=0-3` 返回 206。
- 篡改签名/过期签名 403。
- 普通用户上传媒体 403；未登录 401。
- 容器类型与接口不符 422；超过上限 422。
- 文件不存在 404。
- 测试结束清理临时目录。

### 13.3 手工验证

- 管理端上传视频/音频，刷新章节后学员端可播放、可拖动进度。
- 上传 PNG/JPEG/WebP，头像、封面、富文本图片均正常显示。
- Nginx `X-Accel-Redirect` 模式下 Range 正常。
- 浏览器 Network 面板确认媒体请求为 206，未走公开静态目录。

## 14. 风险与取舍

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 本地盘有状态 | 多实例/容器重建丢文件 | 持久卷 + 备份 + 单实例约束 |
| 视频占用大 | 磁盘快速耗尽、备份成本高 | 容量规划、监控、可配置上限、二期转对象存储 |
| 公开图片 | 图片可被外链 | 图片非核心资产；敏感内容不要走公开图片 |
| 签名 URL 可分享 | 有效期内可转发 | 短 TTL、Referrer-Policy、必要时 HLS 加密 |
| 不做转码 | 上传格式不规范导致播放失败 | 上传规范 + 管理端提示 + 二期 ffprobe/转码 |
| 无断点续传 | 大视频弱网上传失败需重传 | 二期分片/断点续传 |
| 孤儿文件 | 换图/删章节后文件残留 | 一期接受；二期 GC 或引用表 |
| 旧数据不兼容 | 旧 key 无法访问 | 清库重播或独立迁移 |

## 15. 验收标准

- [ ] 图片上传后文件位于 `UPLOAD_DIR/public/image/YYYY/MM/DD/`，公开 URL 可访问。
- [ ] 音视频上传后文件位于 `UPLOAD_DIR/protected/{video|audio}/YYYY/MM/DD/`，签名 URL 可播放。
- [ ] 视频播放支持拖动进度（206）。
- [ ] 普通用户不能调用媒体上传接口；篡改/过期签名返回 403。
- [ ] 章节保存媒体 key 后，学员端能通过服务端返回的地址播放。
- [ ] 运行时不再依赖 `@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner`。
- [ ] `openapi.yaml`、`frontend/src/api/schema.d.ts`、`.env.example` 与实现一致。
- [ ] 单元测试、集成测试、lint、build 全绿；CI 不再启动 MinIO。
- [ ] 部署文档包含持久卷、Nginx 体积/Range/缓存配置与备份要求。

## 16. 后续演进

1. ffprobe 校验编码、时长、分辨率；MP4 faststart 自动修复。
2. 视频封面抽取、时长展示。
3. HLS 转码与多码率；必要时加密。
4. 分片/断点续传与秒传（内容哈希）。
5. 孤儿文件 GC、`MediaAsset` 元数据表、配额。
6. 音视频迁移到对象存储 + CDN；图片可继续本地。
