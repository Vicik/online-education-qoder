# 本地文件与媒体上传实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把图片、视频、音频从 MinIO 私有桶迁移到本地 `uploadFiles` 目录，按 `类型/年/月/日` 分目录保存，图片返回公开地址，音视频返回短期签名播放地址。

**Architecture:** 新增本地存储服务与媒体签名工具，图片走内存缓冲 + sharp 重编码后写入 `public/image/...`；音视频由 multer 流式写入 `tmp/`，校验容器后移动到 `protected/{video|audio}/...`，读取时验签并由 Nest `sendFile` 或 Nginx `X-Accel-Redirect` 提供 Range 支持。前端新增 `MediaUploader` 替换章节弹窗中的 key 文本输入。

**Tech Stack:** NestJS 11、Express、multer、sharp、Node `fs/promises` + `crypto`、Prisma、AntD 5、React 19、axios、Jest、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-12-local-media-upload-design.md`

## Global Constraints

- 单实例部署，`UPLOAD_DIR` 必须是持久卷；多实例方案不在本计划内。
- 图片公开访问；音视频必须走签名 URL，不得暴露 `protected/` 静态目录。
- 音视频上传接口仅管理员可用；图片上传要求登录。
- 一期不做转码、HLS、断点续传、ffprobe、孤儿文件回收。
- 运行时不得再依赖 `@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner`。
- 所有 key 只由服务端生成，日期使用 UTC，格式必须匹配：
  - 图片：`^image/\d{4}/\d{2}/\d{2}/[0-9a-f-]{36}\.(png|jpg|webp)$`
  - 媒体：`^(video|audio)/\d{4}/\d{2}/\d{2}/[0-9a-f-]{36}\.(mp4|webm|m4a|mp3)$`
- 图片固定上限 2MB；音频默认 100MB；视频默认 1GB；签名 URL 默认 4 小时。
- 非测试代码的每个函数、变量、接口字段都要有中文注释；测试文件不加。
- 每个任务结束提交一次；未经用户要求不推送远端。

---

### 任务 1：上传配置与环境变量

**Files:**
- Modify: `backend/src/config/configuration.ts`
- Test: `backend/src/config/configuration.spec.ts`
- Modify: `backend/src/config/config.module.spec.ts`
- Modify: `backend/src/auth/session.middleware.spec.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `AppConfig['upload'] = { dir, publicBaseUrl, signingSecret, audioMaxBytes, videoMaxBytes, mediaUrlTtlSec, xAccelPrefix }`
  - 环境变量：`UPLOAD_DIR`、`PUBLIC_BASE_URL`、`UPLOAD_SIGNING_SECRET`、`UPLOAD_AUDIO_MAX_MB`、`UPLOAD_VIDEO_MAX_MB`、`UPLOAD_MEDIA_TTL_SECONDS`、`UPLOAD_X_ACCEL_PREFIX`

- [ ] **Step 1: 改配置测试，先让旧实现失败**

把 `backend/src/config/configuration.spec.ts` 整体替换为：

```ts
import { resolve } from 'node:path';
import { loadConfig } from './configuration';

// 测试前需要清理的环境变量：避免宿主环境影响断言
const ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'SESSION_SECRET',
  'SESSION_TTL',
  'ORDER_PENDING_TTL_MINUTES',
  'JOB_SCAN_INTERVAL_SECONDS',
  'CORS_ORIGINS',
  'BCRYPT_COST',
  'SEED_DEMO_DATA',
  'UPLOAD_DIR',
  'PUBLIC_BASE_URL',
  'UPLOAD_SIGNING_SECRET',
  'UPLOAD_AUDIO_MAX_MB',
  'UPLOAD_VIDEO_MAX_MB',
  'UPLOAD_MEDIA_TTL_SECONDS',
  'UPLOAD_X_ACCEL_PREFIX',
];

describe('loadConfig', () => {
  // 保存原始环境变量，结束后恢复
  const original = { ...process.env };

  beforeEach(() => {
    // 清空所有相关变量，保证每个用例从默认值开始
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.DATABASE_URL = 'postgres://x';
    process.env.REDIS_URL = 'redis://x';
    process.env.SESSION_SECRET = 's3cret';
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET'])(
    '缺 %s 直接抛错',
    (key) => {
      delete process.env[key];
      expect(() => loadConfig()).toThrow(new RegExp(key));
    },
  );

  it('返回规范化配置', () => {
    const cfg = loadConfig();
    expect(cfg.orderPendingTtlMinutes).toBe(15);
    expect(cfg.bcryptCost).toBe(12);
  });

  it('环境变量覆盖默认值并转换类型', () => {
    process.env.SESSION_TTL = '3600';
    process.env.ORDER_PENDING_TTL_MINUTES = '5';
    process.env.JOB_SCAN_INTERVAL_SECONDS = '30';
    process.env.BCRYPT_COST = '13';
    process.env.CORS_ORIGINS = 'http://a.test,http://b.test';
    process.env.SEED_DEMO_DATA = 'true';

    const cfg = loadConfig();

    expect(cfg.databaseUrl).toBe('postgres://x');
    expect(cfg.redisUrl).toBe('redis://x');
    expect(cfg.sessionSecret).toBe('s3cret');
    expect(cfg.sessionTtl).toBe(3600);
    expect(cfg.orderPendingTtlMinutes).toBe(5);
    expect(cfg.jobScanIntervalSeconds).toBe(30);
    expect(cfg.bcryptCost).toBe(13);
    expect(cfg.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
    expect(cfg.seedDemoData).toBe(true);
  });

  it('未设可选项时取默认值', () => {
    const cfg = loadConfig();
    expect(cfg.sessionTtl).toBe(86400);
    expect(cfg.jobScanIntervalSeconds).toBe(60);
    expect(cfg.corsOrigins).toEqual([]);
    expect(cfg.seedDemoData).toBe(false);
  });

  it('上传配置默认值', () => {
    const cfg = loadConfig();
    expect(cfg.upload.dir).toBe(resolve(process.cwd(), 'uploadFiles'));
    expect(cfg.upload.publicBaseUrl).toBe('http://localhost:3000');
    expect(cfg.upload.signingSecret).toBe('s3cret');
    expect(cfg.upload.audioMaxBytes).toBe(100 * 1024 * 1024);
    expect(cfg.upload.videoMaxBytes).toBe(1024 * 1024 * 1024);
    expect(cfg.upload.mediaUrlTtlSec).toBe(14400);
    expect(cfg.upload.xAccelPrefix).toBe('');
  });

  it('上传配置覆盖默认值，并去掉公开源末尾斜杠', () => {
    process.env.UPLOAD_DIR = 'D:/data/uploadFiles';
    process.env.PUBLIC_BASE_URL = 'https://cdn.example.com/';
    process.env.UPLOAD_SIGNING_SECRET = 'media-secret';
    process.env.UPLOAD_AUDIO_MAX_MB = '50';
    process.env.UPLOAD_VIDEO_MAX_MB = '2048';
    process.env.UPLOAD_MEDIA_TTL_SECONDS = '7200';
    process.env.UPLOAD_X_ACCEL_PREFIX = '/_protected_media/';

    const cfg = loadConfig();

    expect(cfg.upload).toEqual({
      dir: 'D:/data/uploadFiles',
      publicBaseUrl: 'https://cdn.example.com',
      signingSecret: 'media-secret',
      audioMaxBytes: 50 * 1024 * 1024,
      videoMaxBytes: 2048 * 1024 * 1024,
      mediaUrlTtlSec: 7200,
      xAccelPrefix: '/_protected_media/',
    });
  });

  it('SEED_DEMO_DATA 非 true 字面量时视为 false', () => {
    process.env.SEED_DEMO_DATA = '1';
    expect(loadConfig().seedDemoData).toBe(false);
  });
});
```

同时把 `backend/src/config/config.module.spec.ts` 中的 MinIO 清理与断言改为：

```ts
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://x';
    process.env.REDIS_URL = 'redis://x';
    process.env.SESSION_SECRET = 's3cret';
    delete process.env.BCRYPT_COST;
    delete process.env.UPLOAD_DIR;
    delete process.env.PUBLIC_BASE_URL;
  });

  it('ConfigService 暴露 loadConfig 的结果', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
    }).compile();

    const config = moduleRef.get(ConfigService);
    expect(config.get('databaseUrl')).toBe('postgres://x');
    expect(config.get('bcryptCost')).toBe(12);
    expect(config.get('upload')).toMatchObject({
      publicBaseUrl: 'http://localhost:3000',
    });
  });
```

把 `backend/src/auth/session.middleware.spec.ts` 顶部 `config` 字面量里的 `minio` 段替换为（`AppConfig` 已删除 `minio` 字段）：

```ts
  upload: {
    dir: 'uploadFiles',
    publicBaseUrl: 'http://localhost:3000',
    signingSecret: 's3cret',
    audioMaxBytes: 100 * 1024 * 1024,
    videoMaxBytes: 1024 * 1024 * 1024,
    mediaUrlTtlSec: 14400,
    xAccelPrefix: '',
  },
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && npx jest src/config/configuration.spec.ts src/config/config.module.spec.ts src/auth/session.middleware.spec.ts --runInBand`

Expected: FAIL，`cfg.upload` 为 `undefined`，`config.get('upload')` 为 `undefined`。

- [ ] **Step 3: 实现上传配置**

把 `backend/src/config/configuration.ts` 整体替换为：

```ts
import { resolve } from 'node:path';

// 上传配置：本地磁盘目录、公开源、签名密钥与各类上限
export interface UploadConfig {
  dir: string; // 上传根目录
  publicBaseUrl: string; // 生成图片/媒体 URL 的公开源
  signingSecret: string; // 媒体 URL 签名密钥
  audioMaxBytes: number; // 音频单文件上限（字节）
  videoMaxBytes: number; // 视频单文件上限（字节）
  mediaUrlTtlSec: number; // 媒体签名 URL 有效期（秒）
  xAccelPrefix: string; // Nginx X-Accel-Redirect 内部前缀，空表示由 Nest 发送文件
}

// 应用配置接口：定义所有环境变量的类型结构
export interface AppConfig {
  databaseUrl: string; // 数据库连接 URL
  redisUrl: string; // Redis 连接 URL
  sessionSecret: string; // 会话加密密钥
  sessionTtl: number; // 会话过期时间（秒）
  orderPendingTtlMinutes: number; // 订单待支付超时时间（分钟）
  jobScanIntervalSeconds: number; // 定时任务扫描间隔（秒）
  corsOrigins: string[]; // 允许跨域请求的来源列表
  bcryptCost: number; // bcrypt 加密成本因子
  seedDemoData: boolean; // 是否初始化演示数据
  upload: UploadConfig; // 本地文件上传配置
}

// 1MB 的字节数
const MB = 1024 * 1024;
// 媒体签名 URL 默认有效期：4 小时
const DEFAULT_MEDIA_TTL_SEC = 4 * 60 * 60;

// 加载配置函数：从环境变量读取配置，缺失必需变量时抛出异常
export function loadConfig(): AppConfig {
  // 必需的环境变量列表
  const required = ['DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET'];
  // 检查必需环境变量是否存在
  for (const key of required) {
    if (!process.env[key]) throw new Error(`缺少环境变量 ${key}`);
  }

  // 会话密钥：同时作为媒体签名密钥的默认值
  const sessionSecret = process.env.SESSION_SECRET!;
  // 上传根目录：默认进程工作目录下的 uploadFiles
  const uploadDir = process.env.UPLOAD_DIR || resolve(process.cwd(), 'uploadFiles');
  // 公开源：去掉末尾斜杠，避免拼出双斜杠 URL
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );

  // 返回配置对象
  return {
    databaseUrl: process.env.DATABASE_URL!, // 数据库连接 URL
    redisUrl: process.env.REDIS_URL!, // Redis 连接 URL
    sessionSecret, // 会话加密密钥
    sessionTtl: Number(process.env.SESSION_TTL ?? 86400), // 会话过期时间，默认 24 小时
    orderPendingTtlMinutes: Number(process.env.ORDER_PENDING_TTL_MINUTES ?? 15), // 订单待支付超时，默认 15 分钟
    jobScanIntervalSeconds: Number(process.env.JOB_SCAN_INTERVAL_SECONDS ?? 60), // 任务扫描间隔，默认 60 秒
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean), // CORS 允许的来源列表
    bcryptCost: Number(process.env.BCRYPT_COST ?? 12), // bcrypt 成本因子，默认 12
    seedDemoData: process.env.SEED_DEMO_DATA === 'true', // 是否初始化演示数据
    upload: {
      dir: uploadDir, // 上传根目录
      publicBaseUrl, // 公开访问源
      signingSecret: process.env.UPLOAD_SIGNING_SECRET || sessionSecret, // 媒体签名密钥
      audioMaxBytes: Number(process.env.UPLOAD_AUDIO_MAX_MB ?? 100) * MB, // 音频上限，默认 100MB
      videoMaxBytes: Number(process.env.UPLOAD_VIDEO_MAX_MB ?? 1024) * MB, // 视频上限，默认 1GB
      mediaUrlTtlSec: Number(
        process.env.UPLOAD_MEDIA_TTL_SECONDS ?? DEFAULT_MEDIA_TTL_SEC,
      ), // 媒体 URL 有效期，默认 4 小时
      xAccelPrefix: process.env.UPLOAD_X_ACCEL_PREFIX ?? '', // Nginx 内部重定向前缀
    },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd backend && npx jest src/config/configuration.spec.ts src/config/config.module.spec.ts src/auth/session.middleware.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/config/configuration.ts backend/src/config/configuration.spec.ts backend/src/config/config.module.spec.ts backend/src/auth/session.middleware.spec.ts
git commit -m "feat(backend): 本地上传配置替换 MinIO 配置"
```

---

### 任务 2：媒体容器识别

**Files:**
- Create: `backend/src/storage/media-validator.util.ts`
- Test: `backend/src/storage/media-validator.util.spec.ts`

**Interfaces:**
- Consumes: `BizException`、`ErrorCode`。
- Produces:
  - `type MediaKind = 'video' | 'audio'`
  - `type MediaContainer = 'mp4' | 'webm' | 'm4a' | 'mp3'`
  - `detectMediaContainer(buffer: Buffer): MediaContainer | null`
  - `assertMediaContainer(buffer: Buffer, kind: MediaKind): { container: MediaContainer; mimeType: string }`

- [ ] **Step 1: 写失败测试**

创建 `backend/src/storage/media-validator.util.spec.ts`：

```ts
import {
  assertMediaContainer,
  detectMediaContainer,
} from './media-validator.util';

// 构造 ISO BMFF 文件头：4 字节长度 + ftyp + 品牌
function ftyp(brand: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp'),
    Buffer.from(brand),
    Buffer.alloc(8, 0x01),
  ]);
}

// WebM 头 + doctype
const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from([0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84]),
  Buffer.from('webm'),
]);

describe('detectMediaContainer', () => {
  it('识别 MP4、M4A、WebM、MP3', () => {
    expect(detectMediaContainer(ftyp('isom'))).toBe('mp4');
    expect(detectMediaContainer(ftyp('M4A '))).toBe('m4a');
    expect(detectMediaContainer(ftyp('M4B '))).toBe('m4a');
    expect(detectMediaContainer(WEBM)).toBe('webm');
    expect(detectMediaContainer(Buffer.from('ID3\u0004\u0000\u0000'))).toBe('mp3');
    expect(detectMediaContainer(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe('mp3');
  });

  it('无法识别的文本返回 null', () => {
    expect(detectMediaContainer(Buffer.from('not a media file'))).toBeNull();
    expect(detectMediaContainer(Buffer.alloc(0))).toBeNull();
  });
});

describe('assertMediaContainer', () => {
  it('视频接口只接受 MP4/WebM', () => {
    expect(assertMediaContainer(ftyp('isom'), 'video')).toEqual({
      container: 'mp4',
      mimeType: 'video/mp4',
    });
    expect(assertMediaContainer(WEBM, 'video')).toEqual({
      container: 'webm',
      mimeType: 'video/webm',
    });
    expect(() => assertMediaContainer(ftyp('M4A '), 'video')).toThrow();
  });

  it('音频接口只接受 M4A/MP3，并返回对应 MIME', () => {
    expect(assertMediaContainer(ftyp('M4A '), 'audio')).toEqual({
      container: 'm4a',
      mimeType: 'audio/mp4',
    });
    expect(assertMediaContainer(Buffer.from('ID3\u0004\u0000\u0000'), 'audio')).toEqual({
      container: 'mp3',
      mimeType: 'audio/mpeg',
    });
    expect(() => assertMediaContainer(ftyp('isom'), 'audio')).toThrow();
  });

  it('类型不匹配映射为 422/code=1001', () => {
    expect(() => assertMediaContainer(Buffer.from('text'), 'video')).toThrow(
      expect.objectContaining({ bizCode: 1001, status: 422 }),
    );
    expect(() => assertMediaContainer(ftyp('isom'), 'audio')).toThrow(
      expect.objectContaining({ bizCode: 1001, status: 422 }),
    );
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && npx jest src/storage/media-validator.util.spec.ts --runInBand`

Expected: FAIL，提示找不到 `./media-validator.util`。

- [ ] **Step 3: 实现识别工具**

创建 `backend/src/storage/media-validator.util.ts`：

```ts
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';

// 媒体大类：视频或音频
export type MediaKind = 'video' | 'audio';
// 允许的媒体容器
export type MediaContainer = 'mp4' | 'webm' | 'm4a' | 'mp3';

// 每种媒体大类允许的容器
const CONTAINERS_BY_KIND: Record<MediaKind, readonly MediaContainer[]> = {
  video: ['mp4', 'webm'],
  audio: ['m4a', 'mp3'],
};

// 容器到标准 MIME 的映射
export const MIME_BY_CONTAINER: Record<MediaContainer, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
};

// WebM 的 EBML 文件头
const EBML_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

// 根据文件头识别媒体容器；无法识别返回 null
export function detectMediaContainer(buffer: Buffer): MediaContainer | null {
  // ISO BMFF（MP4/M4A）：第 4-7 字节固定为 ftyp
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    // 主品牌位于第 8-11 字节
    const brand = buffer.subarray(8, 12).toString('ascii');
    // M4A/M4B 品牌按音频处理，其余品牌按视频 MP4 处理
    return brand === 'M4A ' || brand === 'M4B ' ? 'm4a' : 'mp4';
  }

  // WebM：EBML 头 + 前 64 字节内出现 doctype webm
  if (
    buffer.length >= 4 &&
    buffer.subarray(0, 4).equals(EBML_HEADER) &&
    buffer
      .subarray(0, Math.min(buffer.length, 64))
      .toString('ascii')
      .includes('webm')
  ) {
    return 'webm';
  }

  // MP3：ID3v2 标签或 MPEG 音频帧同步字
  if (
    (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') ||
    (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    return 'mp3';
  }

  // 其余内容一律视为未知
  return null;
}

// 断言容器与上传接口类型匹配，返回容器与 MIME
export function assertMediaContainer(
  buffer: Buffer,
  kind: MediaKind,
): { container: MediaContainer; mimeType: string } {
  // 先识别真实容器
  const container = detectMediaContainer(buffer);
  if (!container) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '仅支持 MP4/WebM 视频与 MP3/M4A 音频',
      422,
    );
  }
  // 容器必须属于该接口允许的集合
  if (!CONTAINERS_BY_KIND[kind].includes(container)) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '文件类型与上传接口不匹配',
      422,
    );
  }
  return { container, mimeType: MIME_BY_CONTAINER[container] };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd backend && npx jest src/storage/media-validator.util.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/storage/media-validator.util.ts backend/src/storage/media-validator.util.spec.ts
git commit -m "feat(backend): 识别本地媒体容器类型"
```

---

### 任务 3：媒体签名工具

**Files:**
- Create: `backend/src/storage/media-signature.util.ts`
- Test: `backend/src/storage/media-signature.util.spec.ts`

**Interfaces:**
- Consumes: Node `crypto`。
- Produces:
  - `signMediaKey(secret: string, key: string, exp: number): string`
  - `isValidMediaSignature(secret: string, key: string, exp: number, sig: string): boolean`

- [ ] **Step 1: 写失败测试**

创建 `backend/src/storage/media-signature.util.spec.ts`：

```ts
import {
  isValidMediaSignature,
  signMediaKey,
} from './media-signature.util';

// 测试密钥
const SECRET = 'test-secret';
// 固定的媒体 key
const KEY = 'video/2026/11/12/00000000-0000-0000-0000-000000000001.mp4';

// 生成未来时间戳
function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 60;
}

describe('media signature', () => {
  it('生成的签名固定 43 位 base64url 且可验证', () => {
    const exp = futureExp();
    const sig = signMediaKey(SECRET, KEY, exp);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidMediaSignature(SECRET, KEY, exp, sig)).toBe(true);
  });

  it('篡改 key 或签名后验证失败', () => {
    const exp = futureExp();
    const sig = signMediaKey(SECRET, KEY, exp);
    expect(
      isValidMediaSignature(SECRET, `${KEY}x`, exp, sig),
    ).toBe(false);
    const tampered = `${sig.slice(0, 42)}${sig[42] === 'A' ? 'B' : 'A'}`;
    expect(isValidMediaSignature(SECRET, KEY, exp, tampered)).toBe(false);
  });

  it('过期或未来时间戳格式错误时验证失败', () => {
    const expired = Math.floor(Date.now() / 1000) - 10;
    const expiredSig = signMediaKey(SECRET, KEY, expired);
    expect(isValidMediaSignature(SECRET, KEY, expired, expiredSig)).toBe(false);

    const exp = futureExp();
    expect(isValidMediaSignature(SECRET, KEY, exp, 'short')).toBe(false);
    expect(isValidMediaSignature(SECRET, KEY, Number.NaN, signMediaKey(SECRET, KEY, exp))).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && npx jest src/storage/media-signature.util.spec.ts --runInBand`

Expected: FAIL，提示找不到 `./media-signature.util`。

- [ ] **Step 3: 实现签名工具**

创建 `backend/src/storage/media-signature.util.ts`：

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

// 签名格式：SHA-256 的 base64url 固定 43 位
export const MEDIA_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// 生成媒体签名：对 `${key}:${exp}` 做 HMAC-SHA256，输出 base64url
export function signMediaKey(secret: string, key: string, exp: number): string {
  return createHmac('sha256', secret).update(`${key}:${exp}`).digest('base64url');
}

// 校验媒体签名：检查时间戳、格式，并用常量时间比较
export function isValidMediaSignature(
  secret: string,
  key: string,
  exp: number,
  sig: string,
): boolean {
  // exp 必须是整数秒
  if (!Number.isInteger(exp)) return false;
  // 已过期直接拒绝
  if (exp < Math.floor(Date.now() / 1000)) return false;
  // 签名长度与字符集必须匹配
  if (!MEDIA_SIGNATURE_PATTERN.test(sig)) return false;

  // 重新计算期望签名
  const expected = signMediaKey(secret, key, exp);
  // 客户端签名转字节
  const actualBuffer = Buffer.from(sig, 'ascii');
  // 期望签名转字节
  const expectedBuffer = Buffer.from(expected, 'ascii');
  // 长度不一致时提前返回，避免 timingSafeEqual 抛错
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd backend && npx jest src/storage/media-signature.util.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/storage/media-signature.util.ts backend/src/storage/media-signature.util.spec.ts
git commit -m "feat(backend): 增加媒体 URL 签名工具"
```

---

### 任务 4：本地存储服务

**Files:**
- Modify: `backend/src/storage/storage.service.ts`
- Test: `backend/src/storage/storage.service.spec.ts`（整体重写）

**Interfaces:**
- Consumes: `UploadConfig`、`detectImageType`、`assertMediaContainer`、`signMediaKey`、`isValidMediaSignature`、`collectImageKeys`、`applyImageUrls`。
- Produces:
  - `MAX_IMAGE_BYTES`、`IMAGE_KEY_PATTERN`、`MEDIA_KEY_PATTERN`
  - `UploadImageInput = { buffer: Buffer; mimeType: string }`
  - `UploadData = { key: string; url: string }`
  - `SaveMediaInput = { tempPath: string; kind: MediaKind }`
  - `UploadMediaData = { key: string; url: string; mimeType: string; size: number }`
  - `StorageService`：
    - `onModuleInit(): Promise<void>`
    - `uploadImage(input: UploadImageInput): Promise<UploadData>`
    - `saveMedia(input: SaveMediaInput): Promise<UploadMediaData>`
    - `resolveUrl(value: string | null | undefined): Promise<string | null>`
    - `resolveRichHtml(html: string): Promise<string>`
    - `mediaUrl(key: string): string`
    - `verifyMediaSignature(key: string, exp: number, sig: string): boolean`
    - `mediaFilePath(key: string): string`
    - `mediaMimeForKey(key: string): string`
    - `mediaExists(key: string): Promise<boolean>`
    - `xAccelPrefix(): string`

- [ ] **Step 1: 重写测试，先让旧实现失败**

把 `backend/src/storage/storage.service.spec.ts` 整体替换为：

```ts
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from './storage.service';

// sharp 管道替身：链式方法返回自身，toBuffer 由测试控制
const mockPipeline: Record<string, jest.Mock> = {};
// sharp 函数替身，记录输入参数
const mockSharp = jest.fn();

// 隔离 sharp 原生依赖，单测不真正解码图片
jest.mock('sharp', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockSharp(...args),
}));

// PNG 文件头
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// JPEG 文件头
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

// 构造 MP4 文件头
function mp4(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.alloc(8, 0x01),
  ]);
}

// 构造 M4A 文件头
function m4a(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypM4A '),
    Buffer.alloc(8, 0x01),
  ]);
}

// 构造 MP3 文件头
function mp3(): Buffer {
  return Buffer.concat([Buffer.from('ID3'), Buffer.alloc(32, 0x01)]);
}

// ConfigService 替身：固定指向测试目录与上限
function fakeConfig(dir: string): ConfigService {
  return {
    get: jest.fn(() => ({
      dir,
      publicBaseUrl: 'http://cdn.test',
      signingSecret: 'test-secret',
      audioMaxBytes: 1024 * 1024,
      videoMaxBytes: 2 * 1024 * 1024,
      mediaUrlTtlSec: 3600,
      xAccelPrefix: '/_protected_media/',
    })),
  } as unknown as ConfigService;
}

describe('StorageService', () => {
  // 每个用例独立的临时上传根目录
  let dir: string;
  // 被测服务
  let service: StorageService;

  beforeEach(async () => {
    // 重建 sharp 管道替身
    mockPipeline.rotate = jest.fn(() => mockPipeline);
    mockPipeline.png = jest.fn(() => mockPipeline);
    mockPipeline.jpeg = jest.fn(() => mockPipeline);
    mockPipeline.webp = jest.fn(() => mockPipeline);
    mockPipeline.toBuffer = jest.fn();
    mockSharp.mockReturnValue(mockPipeline);

    dir = await mkdtemp(join(tmpdir(), 'zhixu-storage-'));
    service = new StorageService(fakeConfig(dir));
    await service.onModuleInit();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // 在 tmp 目录写一个待处理文件
  async function writeTemp(name: string, content: Buffer): Promise<string> {
    const path = join(dir, 'tmp', name);
    await writeFile(path, content);
    return path;
  }

  it('超过 2MB 的图片拒绝', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    await expect(
      service.uploadImage({ buffer: big, mimeType: 'image/png' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
  });

  it('内容与声明 MIME 不符拒绝', async () => {
    await expect(
      service.uploadImage({ buffer: PNG, mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('PNG 重编码后写入 public/image，返回公开 URL', async () => {
    mockPipeline.toBuffer.mockResolvedValue(Buffer.from('re-encoded'));

    const result = await service.uploadImage({
      buffer: PNG,
      mimeType: 'image/png',
    });

    expect(result.key).toMatch(
      /^image\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.png$/,
    );
    expect(result.url).toBe(`http://cdn.test/uploadFiles/${result.key}`);
    const saved = await readFile(join(dir, 'public', ...result.key.split('/')));
    expect(saved.toString()).toBe('re-encoded');
    expect(mockPipeline.rotate).toHaveBeenCalled();
    expect(mockPipeline.png).toHaveBeenCalled();
  });

  it('JPEG 重编码后扩展名为 .jpg', async () => {
    mockPipeline.toBuffer.mockResolvedValue(Buffer.from('re-encoded'));
    const result = await service.uploadImage({
      buffer: JPEG,
      mimeType: 'image/jpeg',
    });
    expect(result.key).toMatch(/\.jpg$/);
    expect(mockPipeline.jpeg).toHaveBeenCalled();
  });

  it('sharp 无法解码时按 422 拒绝', async () => {
    mockPipeline.toBuffer.mockRejectedValue(new Error('bad image'));
    await expect(
      service.uploadImage({ buffer: PNG, mimeType: 'image/png' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
  });

  it('resolveUrl：图片公开、媒体签名、http 原样、旧 key 返回 null', async () => {
    const imageKey = 'image/2026/11/12/00000000-0000-0000-0000-000000000001.png';
    const mediaKey = 'video/2026/11/12/00000000-0000-0000-0000-000000000002.mp4';

    await expect(service.resolveUrl(imageKey)).resolves.toBe(
      `http://cdn.test/uploadFiles/${imageKey}`,
    );
    const mediaUrl = await service.resolveUrl(mediaKey);
    expect(mediaUrl).toContain('http://cdn.test/api/v1/files/media?');
    expect(mediaUrl).toContain('sig=');
    await expect(service.resolveUrl('https://cdn.test/legacy.png')).resolves.toBe(
      'https://cdn.test/legacy.png',
    );
    await expect(service.resolveUrl('zhixu/2026/11/a.png')).resolves.toBeNull();
    await expect(service.resolveUrl('videos/a.mp4')).resolves.toBeNull();
    await expect(service.resolveUrl('')).resolves.toBeNull();
  });

  it('resolveRichHtml 把 data-key 重写为公开 URL，历史 http 保持不变', async () => {
    const key = 'image/2026/11/12/00000000-0000-0000-0000-000000000003.webp';
    const html =
      `<p>正文</p><img data-key="${key}" src="${key}" alt="图" />` +
      '<img src="https://cdn.test/legacy.png" />';

    const output = await service.resolveRichHtml(html);

    expect(output).toContain(`src="http://cdn.test/uploadFiles/${key}"`);
    expect(output).toContain(`data-key="${key}"`);
    expect(output).toContain('src="https://cdn.test/legacy.png"');
  });

  it('resolveRichHtml 对旧 key 或无图片内容不报错', async () => {
    const legacy = '<img data-key="zhixu/a.png" src="zhixu/a.png" />';
    await expect(service.resolveRichHtml(legacy)).resolves.toBe(legacy);
    await expect(service.resolveRichHtml('')).resolves.toBe('');
  });

  it('媒体签名可验证，篡改与过期失败', () => {
    const key = 'video/2026/11/12/00000000-0000-0000-0000-000000000004.mp4';
    const url = new URL(service.mediaUrl(key));
    const exp = Number(url.searchParams.get('exp')!);
    const sig = url.searchParams.get('sig')!;

    expect(service.verifyMediaSignature(key, exp, sig)).toBe(true);
    expect(service.verifyMediaSignature(`${key}x`, exp, sig)).toBe(false);
    expect(
      service.verifyMediaSignature(key, Math.floor(Date.now() / 1000) - 1, sig),
    ).toBe(false);
    expect(service.verifyMediaSignature('bad/key.mp4', exp, sig)).toBe(false);
  });

  it('saveMedia 校验后移动到 protected，返回 key/签名 URL/MIME/size', async () => {
    const content = mp4();
    const temp = await writeTemp('video.part', content);

    const result = await service.saveMedia({ tempPath: temp, kind: 'video' });

    expect(result.key).toMatch(
      /^video\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.mp4$/,
    );
    expect(result.mimeType).toBe('video/mp4');
    expect(result.size).toBe(content.length);
    expect(result.url).toContain('/api/v1/files/media?');
    await expect(stat(temp)).rejects.toThrow();
    const saved = await readFile(join(dir, 'protected', ...result.key.split('/')));
    expect(saved.equals(content)).toBe(true);
    await expect(service.mediaExists(result.key)).resolves.toBe(true);
  });

  it('saveMedia 接受 MP3 音频，写入 protected/audio', async () => {
    const content = mp3();
    const temp = await writeTemp('audio-mp3.part', content);

    const result = await service.saveMedia({ tempPath: temp, kind: 'audio' });

    expect(result.key).toMatch(
      /^audio\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.mp3$/,
    );
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.size).toBe(content.length);
    const saved = await readFile(join(dir, 'protected', ...result.key.split('/')));
    expect(saved.equals(content)).toBe(true);
  });

  it('saveMedia 音频超过上限时清理临时文件', async () => {
    const content = Buffer.concat([m4a(), Buffer.alloc(1024 * 1024, 0x01)]);
    const temp = await writeTemp('audio.part', content);

    await expect(
      service.saveMedia({ tempPath: temp, kind: 'audio' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    await expect(stat(temp)).rejects.toThrow();
  });

  it('saveMedia 容器与接口不符时清理临时文件', async () => {
    const temp = await writeTemp('mismatch.part', m4a());
    await expect(
      service.saveMedia({ tempPath: temp, kind: 'video' }),
    ).rejects.toMatchObject({ bizCode: 1001 });
    await expect(stat(temp)).rejects.toThrow();
  });

  it('媒体路径拒绝穿越与非法 key', () => {
    expect(() => service.mediaFilePath('video/../../x.mp4')).toThrow(
      expect.objectContaining({ bizCode: 2002, status: 403 }),
    );
    expect(() => service.mediaFilePath('image/2026/11/12/a.png')).toThrow(
      expect.objectContaining({ bizCode: 2002 }),
    );
  });

  it('媒体 MIME 按扩展名返回', () => {
    expect(service.mediaMimeForKey('video/a.mp4')).toBe('video/mp4');
    expect(service.mediaMimeForKey('audio/a.mp3')).toBe('audio/mpeg');
    expect(service.mediaMimeForKey('audio/a.m4a')).toBe('audio/mp4');
  });

  it('启动时清理超过 24 小时的 tmp 文件', async () => {
    const stale = await writeTemp('stale.part', Buffer.from('x'));
    const fresh = await writeTemp('fresh.part', Buffer.from('y'));
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(stale, old, old);

    await service.onModuleInit();

    await expect(stat(stale)).rejects.toThrow();
    await expect(stat(fresh)).resolves.toBeTruthy();
  });

  it('xAccelPrefix 透传配置', () => {
    expect(service.xAccelPrefix()).toBe('/_protected_media/');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && npx jest src/storage/storage.service.spec.ts --runInBand`

Expected: FAIL，旧实现仍依赖 S3，构造参数与返回值都不匹配。

- [ ] **Step 3: 重写本地存储服务**

把 `backend/src/storage/storage.service.ts` 整体替换为：

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { open, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import {
  applyImageUrls,
  collectImageKeys,
} from '../common/utils/media.util';
import type { AppConfig } from '../config/configuration';
import { detectImageType, type ImageType } from './image-validator.util';
import { assertMediaContainer, type MediaKind } from './media-validator.util';
import { isValidMediaSignature, signMediaKey } from './media-signature.util';

// 单张图片体积上限：2MB
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// 图片 key 白名单
export const IMAGE_KEY_PATTERN =
  /^image\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.(png|jpg|webp)$/;
// 媒体 key 白名单
export const MEDIA_KEY_PATTERN =
  /^(video|audio)\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.(mp4|webm|m4a|mp3)$/;
// 识别容器时读取的文件头长度
const MEDIA_HEAD_BYTES = 64 * 1024;
// 临时文件最长保留时间：24 小时
const TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// 图片类型到标准 MIME 的映射
const MIME_BY_TYPE: Record<ImageType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
// 图片类型到文件扩展名的映射（JPEG 统一用 .jpg）
const EXT_BY_TYPE: Record<ImageType, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
};
// 媒体扩展名到 MIME 的映射
const MEDIA_MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
};

// 图片上传入参
export interface UploadImageInput {
  buffer: Buffer; // 文件内容
  mimeType: string; // 客户端声明的 Content-Type
}

// 图片上传结果
export interface UploadData {
  key: string; // 相对 key
  url: string; // 公开访问 URL
}

// 媒体保存入参
export interface SaveMediaInput {
  tempPath: string; // multer 写入的临时文件绝对路径
  kind: MediaKind; // 视频或音频
}

// 媒体上传结果
export interface UploadMediaData {
  key: string; // 相对 key
  url: string; // 短期签名播放 URL
  mimeType: string; // 标准 MIME
  size: number; // 文件字节数
}

// 本地存储服务：图片公开落盘、媒体受保护落盘与签名访问
@Injectable()
export class StorageService implements OnModuleInit {
  // 日志记录器：记录目录初始化与临时文件清理异常
  private readonly logger = new Logger(StorageService.name);

  // 构造函数：注入配置服务
  constructor(private readonly config: ConfigService) {}

  // 模块初始化：创建目录并清理过期临时文件
  async onModuleInit(): Promise<void> {
    await Promise.all([
      mkdir(this.publicRoot(), { recursive: true }),
      mkdir(this.protectedRoot(), { recursive: true }),
      mkdir(this.tmpRoot(), { recursive: true }),
    ]);
    await this.cleanupTmp();
  }

  // 上传图片：校验 → 重编码 → 写 public → 返回公开 URL
  async uploadImage(file: UploadImageInput): Promise<UploadData> {
    // 应用层兜底体积校验
    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new BizException(ErrorCode.PARAM_INVALID, '图片不能超过 2MB', 422);
    }

    // 以文件头识别真实类型
    const type = detectImageType(file.buffer);
    // 声明的 MIME 必须与真实类型一致
    if (file.mimeType !== MIME_BY_TYPE[type]) {
      throw new BizException(ErrorCode.PARAM_INVALID, '图片内容与类型不符', 422);
    }

    // 重编码：rotate() 按 EXIF 摆正，输出不携带元数据
    const pipeline = sharp(file.buffer).rotate();
    // sharp 解码失败说明文件已损坏或伪造成合法文件头
    let cleaned: Buffer;
    try {
      cleaned = await (
        type === 'png'
          ? pipeline.png()
          : type === 'jpeg'
            ? pipeline.jpeg()
            : pipeline.webp()
      ).toBuffer();
    } catch {
      throw new BizException(ErrorCode.PARAM_INVALID, '图片无法解析', 422);
    }

    // 生成图片 key
    const key = `image/${this.datePath()}/${randomUUID()}.${EXT_BY_TYPE[type]}`;
    // 目标绝对路径
    const target = join(this.publicRoot(), key);
    await mkdir(dirname(target), { recursive: true });

    // 同目录临时文件 + rename，避免读取到半截文件
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, cleaned);
    await rename(temp, target);

    return { key, url: this.imageUrl(key) };
  }

  // 保存音视频：校验体积与容器 → 移动到 protected → 返回签名 URL
  async saveMedia(input: SaveMediaInput): Promise<UploadMediaData> {
    try {
      // 读取临时文件大小
      const info = await stat(input.tempPath);
      // 按类型选择上限
      const max =
        input.kind === 'video'
          ? this.upload().videoMaxBytes
          : this.upload().audioMaxBytes;

      if (info.size > max) {
        const label = input.kind === 'video' ? '视频' : '音频';
        const limitMb = Math.floor(max / (1024 * 1024));
        throw new BizException(
          ErrorCode.PARAM_INVALID,
          `${label}不能超过 ${limitMb}MB`,
          422,
        );
      }

      // 读取文件头识别真实容器
      const head = await this.readHead(input.tempPath);
      const { container, mimeType } = assertMediaContainer(head, input.kind);

      // 生成媒体 key
      const key = `${input.kind}/${this.datePath()}/${randomUUID()}.${container}`;
      // 目标绝对路径
      const target = join(this.protectedRoot(), key);
      await mkdir(dirname(target), { recursive: true });
      // 临时文件移动到受保护目录
      await rename(input.tempPath, target);

      return { key, url: this.mediaUrl(key), mimeType, size: info.size };
    } catch (error) {
      // 任何失败都清理临时文件
      await rm(input.tempPath, { force: true });
      throw error;
    }
  }

  // 解析存储值：图片给公开 URL，媒体给签名 URL，历史 http(s) 原样，未知返回 null
  async resolveUrl(value: string | null | undefined): Promise<string | null> {
    if (value === null || value === undefined || value === '') return null;
    // 历史数据兼容：已是对外地址则不再处理
    if (/^https?:\/\//i.test(value)) return value;
    // 图片 key：公开静态地址
    if (IMAGE_KEY_PATTERN.test(value)) return this.imageUrl(value);
    // 媒体 key：短期签名地址
    if (MEDIA_KEY_PATTERN.test(value)) return this.mediaUrl(value);
    // 旧 MinIO key 与非法值不再透传
    return null;
  }

  // 富文本图片解析：把 data-key 重写为图片公开地址，保留 data-key
  async resolveRichHtml(html: string): Promise<string> {
    if (!html) return html;
    // 收集待重写的 key
    const keys = collectImageKeys(html);
    if (keys.length === 0) return html;

    // 可解析的 key -> URL
    const urls = new Map<string, string>();
    for (const key of keys) {
      const url = await this.resolveUrl(key);
      if (url) urls.set(key, url);
    }
    // 全部无法解析时原样返回
    if (urls.size === 0) return html;
    return applyImageUrls(html, urls);
  }

  // 生成媒体播放地址：签名覆盖 key 与过期时间
  mediaUrl(key: string): string {
    const exp = Math.floor(Date.now() / 1000) + this.upload().mediaUrlTtlSec;
    const sig = signMediaKey(this.upload().signingSecret, key, exp);
    const query = new URLSearchParams({ key, exp: String(exp), sig });
    return `${this.upload().publicBaseUrl}/api/v1/files/media?${query.toString()}`;
  }

  // 校验媒体签名：key 必须符合白名单
  verifyMediaSignature(key: string, exp: number, sig: string): boolean {
    if (!MEDIA_KEY_PATTERN.test(key)) return false;
    return isValidMediaSignature(
      this.upload().signingSecret,
      key,
      exp,
      sig,
    );
  }

  // 媒体 key 映射到 protected 下的绝对路径，并阻断路径穿越
  mediaFilePath(key: string): string {
    if (!MEDIA_KEY_PATTERN.test(key)) {
      throw new BizException(ErrorCode.FORBIDDEN, '链接无效或已过期', 403);
    }
    const root = this.protectedRoot();
    const target = resolve(root, key);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new BizException(ErrorCode.FORBIDDEN, '链接无效或已过期', 403);
    }
    return target;
  }

  // 媒体 MIME：按扩展名返回
  mediaMimeForKey(key: string): string {
    const ext = extname(key).slice(1).toLowerCase();
    return MEDIA_MIME_BY_EXT[ext] ?? 'application/octet-stream';
  }

  // 媒体文件是否存在
  async mediaExists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.mediaFilePath(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  // Nginx 内部重定向前缀
  xAccelPrefix(): string {
    return this.upload().xAccelPrefix;
  }

  // 读取上传配置段
  private upload(): AppConfig['upload'] {
    return this.config.get<AppConfig['upload']>('upload')!;
  }

  // public 根目录
  private publicRoot(): string {
    return join(this.upload().dir, 'public');
  }

  // protected 根目录
  private protectedRoot(): string {
    return join(this.upload().dir, 'protected');
  }

  // tmp 根目录
  private tmpRoot(): string {
    return join(this.upload().dir, 'tmp');
  }

  // UTC 日期路径：YYYY/MM/DD
  private datePath(): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  }

  // 图片公开 URL
  private imageUrl(key: string): string {
    return `${this.upload().publicBaseUrl}/uploadFiles/${key}`;
  }

  // 读取文件头，避免把大文件整体读入内存
  private async readHead(path: string): Promise<Buffer> {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(MEDIA_HEAD_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  // 清理超过 24 小时的 tmp 文件
  private async cleanupTmp(): Promise<void> {
    const now = Date.now();
    const entries = await readdir(this.tmpRoot(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(this.tmpRoot(), entry.name);
      try {
        const info = await stat(path);
        if (now - info.mtimeMs > TMP_MAX_AGE_MS) {
          await rm(path, { force: true });
        }
      } catch (error) {
        this.logger.warn(`清理临时文件失败：${(error as Error).message}`);
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd backend && npx jest src/storage/storage.service.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/storage/storage.service.ts backend/src/storage/storage.service.spec.ts
git commit -m "feat(backend): 本地磁盘存储与媒体签名"
```

---

### 任务 5：上传控制器、媒体读取与模块装配

**Files:**
- Create: `backend/src/storage/upload-too-large.filter.ts`
- Create: `backend/src/storage/admin-files.controller.ts`
- Create: `backend/src/storage/media.controller.ts`
- Modify: `backend/src/storage/files.controller.ts`
- Modify: `backend/src/storage/storage.module.ts`
- Modify: `backend/src/main.ts`
- Modify: `backend/package.json`（声明直接依赖 `multer`）
- Modify: `backend/package-lock.json`（由 npm 生成）
- Test: `backend/src/storage/media.controller.spec.ts`
- Test: `backend/src/storage/admin-files.controller.spec.ts`

**Interfaces:**
- Consumes: `StorageService` 全部方法。
- Produces:
  - `POST /api/v1/admin/files/video`
  - `POST /api/v1/admin/files/audio`
  - `GET /api/v1/files/media?key=&exp=&sig=`
  - `GET /uploadFiles/image/...` 静态图片
  - `UploadTooLargeFilter(message: string)`

- [ ] **Step 1: 写控制器失败测试**

创建 `backend/src/storage/media.controller.spec.ts`：

```ts
import { MediaController } from './media.controller';

// 最小响应替身
function fakeResponse() {
  return {
    setHeader: jest.fn(),
    end: jest.fn(),
    sendFile: jest.fn(),
    headersSent: false,
  };
}

// 合法的媒体 key
const KEY = 'video/2026/11/12/00000000-0000-0000-0000-000000000001.mp4';
// 未来过期时间
const EXP = String(Math.floor(Date.now() / 1000) + 60);
// 形状正确的签名
const SIG = 'a'.repeat(43);

describe('MediaController', () => {
  it('签名无效返回 403/code=2002', async () => {
    const storage = {
      verifyMediaSignature: jest.fn().mockReturnValue(false),
    };
    const controller = new MediaController(storage as never);
    await expect(
      controller.media(KEY, EXP, SIG, fakeResponse() as never, jest.fn()),
    ).rejects.toMatchObject({ bizCode: 2002, status: 403 });
  });

  it('文件不存在返回 404/code=1002', async () => {
    const storage = {
      verifyMediaSignature: jest.fn().mockReturnValue(true),
      mediaExists: jest.fn().mockResolvedValue(false),
    };
    const controller = new MediaController(storage as never);
    await expect(
      controller.media(KEY, EXP, SIG, fakeResponse() as never, jest.fn()),
    ).rejects.toMatchObject({ bizCode: 1002, status: 404 });
  });

  it('配置 X-Accel 时只设置内部重定向并结束响应', async () => {
    const storage = {
      verifyMediaSignature: jest.fn().mockReturnValue(true),
      mediaExists: jest.fn().mockResolvedValue(true),
      xAccelPrefix: jest.fn().mockReturnValue('/_protected_media/'),
      mediaFilePath: jest.fn(),
      mediaMimeForKey: jest.fn(),
    };
    const response = fakeResponse();
    const controller = new MediaController(storage as never);

    await controller.media(KEY, EXP, SIG, response as never, jest.fn());

    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Accel-Redirect',
      `/_protected_media/${KEY}`,
    );
    expect(response.end).toHaveBeenCalled();
    expect(response.sendFile).not.toHaveBeenCalled();
  });

  it('未配置 X-Accel 时由 Nest 发送文件', async () => {
    const storage = {
      verifyMediaSignature: jest.fn().mockReturnValue(true),
      mediaExists: jest.fn().mockResolvedValue(true),
      xAccelPrefix: jest.fn().mockReturnValue(''),
      mediaFilePath: jest.fn().mockReturnValue('D:/uploads/protected/a.mp4'),
      mediaMimeForKey: jest.fn().mockReturnValue('video/mp4'),
    };
    const response = fakeResponse();
    const controller = new MediaController(storage as never);

    await controller.media(KEY, EXP, SIG, response as never, jest.fn());

    expect(response.sendFile).toHaveBeenCalledWith(
      'D:/uploads/protected/a.mp4',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'video/mp4',
          'Content-Disposition': 'inline',
        }),
      }),
      expect.any(Function),
    );
    expect(response.end).not.toHaveBeenCalled();
  });
});
```

创建 `backend/src/storage/admin-files.controller.spec.ts`：

```ts
import { AdminFilesController } from './admin-files.controller';

describe('AdminFilesController', () => {
  it('未选择文件返回 400/code=1001', async () => {
    const controller = new AdminFilesController({} as never);
    await expect(controller.uploadVideo(undefined)).rejects.toMatchObject({
      bizCode: 1001,
      status: 400,
    });
  });

  it('把临时路径与类型交给存储服务', async () => {
    const storage = { saveMedia: jest.fn().mockResolvedValue({ key: 'video/x.mp4' }) };
    const controller = new AdminFilesController(storage as never);

    await controller.uploadVideo({ path: 'D:/uploads/tmp/a.part' } as never);
    expect(storage.saveMedia).toHaveBeenCalledWith({
      tempPath: 'D:/uploads/tmp/a.part',
      kind: 'video',
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd backend && npx jest src/storage/media.controller.spec.ts src/storage/admin-files.controller.spec.ts --runInBand`

Expected: FAIL，找不到控制器文件。

- [ ] **Step 3: 实现过滤器、控制器与模块**

先声明 `multer` 直接依赖（模块与图片控制器会直接 import）：

```bash
cd backend && npm install multer@^2.4.0
```

创建 `backend/src/storage/upload-too-large.filter.ts`：

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';

// 上传体积超限过滤器：multer 抛 413，按接口契约改写为 422/code=1001
@Catch(PayloadTooLargeException)
export class UploadTooLargeFilter implements ExceptionFilter {
  // 复用全局过滤器，保证响应包格式一致
  private readonly delegate = new AllExceptionsFilter();

  // 构造函数：接收面向用户的提示文案
  constructor(private readonly message: string) {}

  // 异常处理：413 转为业务异常后交给全局过滤器
  catch(_exception: unknown, host: ArgumentsHost): void {
    this.delegate.catch(
      new BizException(ErrorCode.PARAM_INVALID, this.message, 422),
      host,
    );
  }
}
```

创建 `backend/src/storage/admin-files.controller.ts`：

```ts
import {
  Controller,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { Roles } from '../common/decorators/roles.decorator';
import type { MediaKind } from './media-validator.util';
import { StorageService } from './storage.service';
import { UploadTooLargeFilter } from './upload-too-large.filter';

// 管理端文件上传：音视频仅管理员可用
@Controller('admin/files')
@Roles('admin')
export class AdminFilesController {
  // 构造函数：注入存储服务
  constructor(private readonly storage: StorageService) {}

  // 上传视频
  @Post('video')
  @UseInterceptors(FileInterceptor('file'))
  @UseFilters(new UploadTooLargeFilter('视频超过上传上限'))
  uploadVideo(@UploadedFile() file?: Express.Multer.File) {
    return this.save(file, 'video');
  }

  // 上传音频
  @Post('audio')
  @UseInterceptors(FileInterceptor('file'))
  @UseFilters(new UploadTooLargeFilter('音频超过上传上限'))
  uploadAudio(@UploadedFile() file?: Express.Multer.File) {
    return this.save(file, 'audio');
  }

  // 统一校验文件并交给存储服务
  private save(file: Express.Multer.File | undefined, kind: MediaKind) {
    if (!file) {
      throw new BizException(ErrorCode.PARAM_INVALID, '请选择要上传的文件', 400);
    }
    return this.storage.saveMedia({ tempPath: file.path, kind });
  }
}
```

创建 `backend/src/storage/media.controller.ts`：

```ts
import {
  Controller,
  Get,
  Next,
  Query,
  Res,
} from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { Public } from '../common/decorators/public.decorator';
import { StorageService } from './storage.service';

// 媒体读取：签名即授权，支持 Range
@Controller('files')
export class MediaController {
  // 构造函数：注入存储服务
  constructor(private readonly storage: StorageService) {}

  // 读取媒体：验签 → 确认存在 → X-Accel 或直接发送
  @Get('media')
  @Public()
  async media(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() response: Response,
    @Next() next: NextFunction,
  ): Promise<void> {
    // 过期时间转数字
    const expires = Number(exp);
    // 签名必须有效
    if (
      !key ||
      !sig ||
      !Number.isInteger(expires) ||
      !this.storage.verifyMediaSignature(key, expires, sig)
    ) {
      throw new BizException(ErrorCode.FORBIDDEN, '链接无效或已过期', 403);
    }

    // 有效签名但文件不存在
    if (!(await this.storage.mediaExists(key))) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '文件不存在', 404);
    }

    // 生产环境交给 Nginx 发送，避免 Node 占用文件 IO
    const prefix = this.storage.xAccelPrefix();
    if (prefix) {
      const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
      response.setHeader('X-Accel-Redirect', `${normalized}${key}`);
      response.setHeader(
        'Cache-Control',
        'private, max-age=0, must-revalidate',
      );
      response.end();
      return;
    }

    // 开发/小流量环境由 Express 发送，自动支持 Range/206
    response.sendFile(
      this.storage.mediaFilePath(key),
      {
        headers: {
          'Content-Type': this.storage.mediaMimeForKey(key),
          'Content-Disposition': 'inline',
          'Cache-Control': 'private, max-age=0, must-revalidate',
          'X-Content-Type-Options': 'nosniff',
        },
        dotfiles: 'deny',
        acceptRanges: true,
      },
      (error) => {
        // 响应尚未发送时交给全局异常过滤器
        if (error && !response.headersSent) next(error);
      },
    );
  }
}
```

修改 `backend/src/storage/files.controller.ts`：

```ts
import {
  Controller,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { MAX_IMAGE_BYTES, StorageService } from './storage.service';
import { UploadTooLargeFilter } from './upload-too-large.filter';

// 文件接口控制器：登录用户上传图片
@Controller('files')
export class FilesController {
  // 构造函数：注入存储服务
  constructor(private readonly storage: StorageService) {}

  // 图片上传：内存缓冲 + 2MB 硬限制
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  @UseFilters(new UploadTooLargeFilter('图片不能超过 2MB'))
  upload(@UploadedFile() file?: Express.Multer.File) {
    // 未携带文件时给出明确提示
    if (!file) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '请选择要上传的图片',
        400,
      );
    }
    return this.storage.uploadImage({
      buffer: file.buffer,
      mimeType: file.mimetype,
    });
  }
}
```

把 `backend/src/storage/storage.module.ts` 整体替换为：

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { diskStorage } from 'multer';
import type { AppConfig } from '../config/configuration';
import { AdminFilesController } from './admin-files.controller';
import { FilesController } from './files.controller';
import { MediaController } from './media.controller';
import { StorageService } from './storage.service';

// 文件存储模块：图片上传、媒体上传与签名读取（全局导出）
@Global()
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        // 读取上传配置
        const upload = config.get<AppConfig['upload']>('upload')!;
        // 临时目录：音视频先流式落盘
        const tmpDir = join(upload.dir, 'tmp');
        await mkdir(tmpDir, { recursive: true });
        return {
          storage: diskStorage({
            destination: tmpDir,
            // 临时文件名：随机 UUID，避免并发上传互相覆盖
            filename: (_request, _file, callback) => {
              callback(null, `${randomUUID()}.part`);
            },
          }),
          limits: { files: 1, fileSize: upload.videoMaxBytes },
        };
      },
    }),
  ],
  controllers: [FilesController, AdminFilesController, MediaController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
```

修改 `backend/src/main.ts`，把应用类型改为 Express 并挂载静态目录。关键片段：

```ts
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
```

```ts
  // 创建 NestJS 应用实例：使用 Express 适配器以挂载静态目录
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // 公开图片：/uploadFiles/ 指向 UPLOAD_DIR/public
  app.useStaticAssets(join(config.upload.dir, 'public'), {
    prefix: '/uploadFiles/',
    index: false,
    maxAge: '365d',
    immutable: true,
    setHeaders: (response) =>
      response.setHeader('X-Content-Type-Options', 'nosniff'),
  });
```

- [ ] **Step 4: 运行控制器测试与构建**

Run: `cd backend && npx jest src/storage/media.controller.spec.ts src/storage/admin-files.controller.spec.ts --runInBand && npm run build`

Expected: PASS，且 TypeScript 构建成功。

- [ ] **Step 5: 提交**

```bash
git add backend/src/storage/upload-too-large.filter.ts backend/src/storage/admin-files.controller.ts backend/src/storage/media.controller.ts backend/src/storage/files.controller.ts backend/src/storage/storage.module.ts backend/src/storage/media.controller.spec.ts backend/src/storage/admin-files.controller.spec.ts backend/src/main.ts backend/package.json backend/package-lock.json
git commit -m "feat(backend): 本地媒体上传与签名读取接口"
```

---

### 任务 6：富文本方法改名与调用点

**Files:**
- Modify: `backend/src/catalog/course.service.ts`
- Modify: `backend/src/community/post/post.service.ts`
- Modify: `backend/src/community/comment/comment.service.ts`
- Modify: `backend/src/catalog/course.service.spec.ts`
- Modify: `backend/src/community/post/post.service.spec.ts`
- Modify: `backend/src/community/comment/comment.service.spec.ts`

**Interfaces:**
- Consumes: `StorageService.resolveRichHtml`。
- Produces: 代码库中不再出现 `signRichHtml`。

- [ ] **Step 1: 先把测试替身改成新方法名，确认失败**

```bash
cd backend
grep -rl "signRichHtml" src test
```

把以下文件中的 `signRichHtml` 全部改为 `resolveRichHtml`：

- `src/catalog/course.service.spec.ts`
- `src/community/post/post.service.spec.ts`
- `src/community/comment/comment.service.spec.ts`

Run: `cd backend && npx jest src/catalog/course.service.spec.ts src/community/post/post.service.spec.ts src/community/comment/comment.service.spec.ts --runInBand`

Expected: FAIL，真实服务仍调用 `signRichHtml`，与替身不匹配。

- [ ] **Step 2: 改实现调用点**

把以下文件中的 `signRichHtml` 全部改为 `resolveRichHtml`：

- `src/catalog/course.service.ts`（课程详情富文本、章节富文本两处）
- `src/community/post/post.service.ts`（帖子正文、评论、回复三处）
- `src/community/comment/comment.service.ts`（创建评论、评论列表两处）

改完后执行：

```bash
cd backend
grep -rn "signRichHtml" src test
```

Expected: 无输出。

- [ ] **Step 3: 运行相关测试**

Run: `cd backend && npx jest src/catalog/course.service.spec.ts src/community/post/post.service.spec.ts src/community/comment/comment.service.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add backend/src/catalog/course.service.ts backend/src/catalog/course.service.spec.ts backend/src/community/post/post.service.ts backend/src/community/post/post.service.spec.ts backend/src/community/comment/comment.service.ts backend/src/community/comment/comment.service.spec.ts
git commit -m "refactor(backend): 富文本图片解析改用本地公开地址"
```

---

### 任务 7：集成测试改为临时目录

**Files:**
- Modify: `backend/test/integration/upload.spec.ts`（整体重写）

**Interfaces:**
- Consumes: 任务 1–6 的接口与 `signMediaKey`。
- Produces: 不再依赖 testcontainers/MinIO 的上传集成测试。

- [ ] **Step 1: 重写集成测试，先让它失败**

把 `backend/test/integration/upload.spec.ts` 整体替换为：

```ts
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import { signMediaKey } from '../../src/storage/media-signature.util';
import { DEMO_ADMIN, DEMO_USER } from '../../prisma/seed-data';

jest.setTimeout(60_000);

// 1x1 真实 PNG（sharp 可解码）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// 最小 MP4 文件头
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.alloc(32, 0x01),
]);
// 最小 M4A 文件头
const M4A = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypM4A '),
  Buffer.alloc(32, 0x01),
]);
// 集成测试固定签名密钥
const SIGNING_SECRET = 'upload-test-secret';

describe('文件上传（CI 集成，本地磁盘）', () => {
  // Nest 应用实例
  let app: NestExpressApplication;
  // 临时上传根目录
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zhixu-upload-'));
    // 必须在导入 AppModule 前写入上传配置
    process.env.UPLOAD_DIR = dir;
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    process.env.UPLOAD_SIGNING_SECRET = SIGNING_SECRET;
    process.env.UPLOAD_AUDIO_MAX_MB = '1';
    process.env.UPLOAD_VIDEO_MAX_MB = '2';

    // 动态导入：确保配置在模块加载时读取临时目录
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    const config = loadConfig();
    const redis = app.get(RedisService);
    // 与 main.ts 一致：路由注册前挂载会话中间件
    app.use(sessionMiddleware(config, () => redis.getClient()));
    // 与 main.ts 一致：公开图片静态目录
    app.useStaticAssets(join(config.upload.dir, 'public'), {
      prefix: '/uploadFiles/',
      index: false,
      maxAge: '365d',
      immutable: true,
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.UPLOAD_DIR;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.UPLOAD_SIGNING_SECRET;
    delete process.env.UPLOAD_AUDIO_MAX_MB;
    delete process.env.UPLOAD_VIDEO_MAX_MB;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // 登录指定演示账号，返回带会话的 supertest agent
  async function login(user: { email: string; password: string }) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    return agent;
  }

  it('图片上传成功 → 文件位于 public/image → 公开 URL 可访问', async () => {
    const agent = await login(DEMO_USER);
    const response = await agent
      .post('/api/v1/files/upload')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);

    const { key, url } = response.body.data as { key: string; url: string };
    expect(key).toMatch(/^image\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(url).toBe(`http://localhost:3000/uploadFiles/${key}`);
    await expect(
      stat(join(dir, 'public', ...key.split('/'))),
    ).resolves.toBeTruthy();

    const fetched = await request(app.getHttpServer())
      .get(new URL(url).pathname)
      .expect(200);
    expect(fetched.headers['content-type']).toContain('image/png');
  });

  it('伪造扩展名的文本 422/code=1001', async () => {
    const agent = await login(DEMO_USER);
    const response = await agent
      .post('/api/v1/files/upload')
      .attach('file', Buffer.from('not an image'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(422);
    expect(response.body.code).toBe(1001);
  });

  it('图片超过 2MB 返回 422/code=1001', async () => {
    const agent = await login(DEMO_USER);
    const response = await agent
      .post('/api/v1/files/upload')
      .attach('file', Buffer.alloc(2 * 1024 * 1024 + 1, 1), {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(422);
    expect(response.body.code).toBe(1001);
  });

  it('未登录上传图片 401/code=2001', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/files/upload')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(401);
    expect(response.body.code).toBe(2001);
  });

  it('管理员上传视频 → 文件位于 protected/video → Range 返回 206', async () => {
    const agent = await login(DEMO_ADMIN);
    const response = await agent
      .post('/api/v1/admin/files/video')
      .attach('file', MP4, { filename: 'v.mp4', contentType: 'video/mp4' })
      .expect(201);

    const data = response.body.data as {
      key: string;
      url: string;
      mimeType: string;
      size: number;
    };
    expect(data.key).toMatch(
      /^video\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.mp4$/,
    );
    expect(data).toMatchObject({ mimeType: 'video/mp4', size: MP4.length });
    await expect(
      stat(join(dir, 'protected', ...data.key.split('/'))),
    ).resolves.toBeTruthy();

    const mediaUrl = new URL(data.url);
    const mediaPath = `${mediaUrl.pathname}${mediaUrl.search}`;
    const full = await request(app.getHttpServer()).get(mediaPath).expect(200);
    expect(full.headers['content-type']).toContain('video/mp4');

    const range = await request(app.getHttpServer())
      .get(mediaPath)
      .set('Range', 'bytes=0-3')
      .expect(206);
    expect(range.headers['content-range']).toMatch(/^bytes 0-3\//);
  });

  it('管理员上传音频 M4A 成功', async () => {
    const agent = await login(DEMO_ADMIN);
    const response = await agent
      .post('/api/v1/admin/files/audio')
      .attach('file', M4A, { filename: 'a.m4a', contentType: 'audio/mp4' })
      .expect(201);
    expect(response.body.data.key).toMatch(
      /^audio\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.m4a$/,
    );
    expect(response.body.data.mimeType).toBe('audio/mp4');
  });

  it('普通用户上传媒体 403；未登录 401', async () => {
    const user = await login(DEMO_USER);
    const forbidden = await user
      .post('/api/v1/admin/files/video')
      .attach('file', MP4, { filename: 'v.mp4', contentType: 'video/mp4' })
      .expect(403);
    expect(forbidden.body.code).toBe(2002);

    const unauthorized = await request(app.getHttpServer())
      .post('/api/v1/admin/files/audio')
      .attach('file', M4A, { filename: 'a.m4a', contentType: 'audio/mp4' })
      .expect(401);
    expect(unauthorized.body.code).toBe(2001);
  });

  it('视频接口收到 M4A 422；音频超过 1MB 422', async () => {
    const agent = await login(DEMO_ADMIN);
    const mismatch = await agent
      .post('/api/v1/admin/files/video')
      .attach('file', M4A, { filename: 'a.m4a', contentType: 'audio/mp4' })
      .expect(422);
    expect(mismatch.body.code).toBe(1001);

    const oversized = await agent
      .post('/api/v1/admin/files/audio')
      .attach('file', Buffer.concat([M4A, Buffer.alloc(1024 * 1024, 1)]), {
        filename: 'big.m4a',
        contentType: 'audio/mp4',
      })
      .expect(422);
    expect(oversized.body.code).toBe(1001);
  });

  it('篡改签名 403；过期签名 403；文件不存在 404', async () => {
    const tampered = await request(app.getHttpServer())
      .get(
        '/api/v1/files/media?key=video%2F2026%2F01%2F01%2F00000000-0000-0000-0000-000000000001.mp4&exp=9999999999&sig=' +
          'a'.repeat(43),
      )
      .expect(403);
    expect(tampered.body.code).toBe(2002);

    const key = `video/2026/01/01/${randomUUID()}.mp4`;
    const expired = Math.floor(Date.now() / 1000) - 10;
    const expiredUrl = `/api/v1/files/media?key=${encodeURIComponent(key)}&exp=${expired}&sig=${signMediaKey(SIGNING_SECRET, key, expired)}`;
    const expiredResponse = await request(app.getHttpServer())
      .get(expiredUrl)
      .expect(403);
    expect(expiredResponse.body.code).toBe(2002);

    const missingExp = Math.floor(Date.now() / 1000) + 60;
    const missingUrl = `/api/v1/files/media?key=${encodeURIComponent(key)}&exp=${missingExp}&sig=${signMediaKey(SIGNING_SECRET, key, missingExp)}`;
    const missing = await request(app.getHttpServer())
      .get(missingUrl)
      .expect(404);
    expect(missing.body.code).toBe(1002);
  });
});
```

- [ ] **Step 2: 运行集成测试，确认契约**

Run: `cd backend && npx jest --config jest.integration.config.js test/integration/upload.spec.ts --runInBand`

Expected: 若任务 1–6 已按计划完成应直接 PASS；任何 FAIL 都必须按 Step 3 修改实现，禁止放宽或删除断言。

- [ ] **Step 3: 修复测试暴露的问题**

按失败信息逐项处理，但不得放宽断言。常见问题与处理：

- `FileInterceptor` 没有使用模块级 diskStorage：确认 `MulterModule.registerAsync` 在 `StorageModule` 的 `imports` 中，`AdminFilesController` 的 `FileInterceptor('file')` 未传第二参数。
- 静态图片 404：确认测试里 `useStaticAssets` 的 `prefix` 为 `/uploadFiles/`，且 `UPLOAD_DIR` 在动态导入 `AppModule` 前设置。
- Range 不是 206：确认实际走 `response.sendFile`（测试未设置 `UPLOAD_X_ACCEL_PREFIX`），且 `acceptRanges: true`。

- [ ] **Step 4: 再跑集成测试，确认通过**

Run: `cd backend && npx jest --config jest.integration.config.js test/integration/upload.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/test/integration/upload.spec.ts
git commit -m "test(backend): 上传集成测试改用临时本地目录"
```

---

### 任务 8：前端媒体校验与上传 API

**Files:**
- Modify: `frontend/src/lib/validators.ts`
- Modify: `frontend/src/api/files.ts`
- Modify: `frontend/tests/unit/validators.test.ts`
- Create: `frontend/tests/api/files.test.ts`

**Interfaces:**
- Consumes: 后端 `/admin/files/{video|audio}`。
- Produces:
  - `MediaKind`、`MAX_AUDIO_BYTES`、`MAX_VIDEO_BYTES`、`ALLOWED_VIDEO_TYPES`、`ALLOWED_AUDIO_TYPES`、`isAllowedMedia(file, kind)`
  - `MediaUploadResult`、`uploadMedia(file, kind, options?)`

- [ ] **Step 1: 写失败测试**

在 `frontend/tests/unit/validators.test.ts` 的 import 中加入 `isAllowedMedia`，并在文件末尾追加：

```ts
// 构造指定大小的伪文件：jsdom 不允许真的分配 1GB
function fakeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('isAllowedMedia', () => {
  it('视频按 MIME 或扩展名识别，并限制 1GB', () => {
    expect(isAllowedMedia(fakeFile('a.mp4', 'video/mp4', 1024), 'video')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.webm', 'video/webm', 1024), 'video')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.mp4', '', 1024), 'video')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.mkv', 'video/x-matroska', 1024), 'video')).toBe(false);
    expect(isAllowedMedia(fakeFile('a.mp4', 'video/mp4', 1024 * 1024 * 1024), 'video')).toBe(
      true,
    );
    expect(
      isAllowedMedia(fakeFile('a.mp4', 'video/mp4', 1024 * 1024 * 1024 + 1), 'video'),
    ).toBe(false);
  });

  it('音频接受 MP3/M4A，并限制 100MB', () => {
    expect(isAllowedMedia(fakeFile('a.mp3', 'audio/mpeg', 1024), 'audio')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.m4a', 'audio/mp4', 1024), 'audio')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.m4a', '', 1024), 'audio')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.wav', 'audio/wav', 1024), 'audio')).toBe(false);
    expect(
      isAllowedMedia(fakeFile('a.mp3', 'audio/mpeg', 100 * 1024 * 1024 + 1), 'audio'),
    ).toBe(false);
  });

  it('空文件不允许', () => {
    expect(isAllowedMedia(fakeFile('a.mp4', 'video/mp4', 0), 'video')).toBe(false);
  });
});
```

创建 `frontend/tests/api/files.test.ts`：

```ts
import { http, HttpResponse } from 'msw';
import { uploadMedia } from '@/api/files';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-files' };
}

// 构造视频文件
function videoFile(): File {
  return new File(['test'], 'a.mp4', { type: 'video/mp4' });
}

describe('files api', () => {
  it('上传视频到管理端接口并返回 key/url/mimeType/size', async () => {
    // 捕获请求体是否为 multipart
    let contentType = '';
    server.use(
      http.post(/\/api\/v1\/admin\/files\/video$/, ({ request }) => {
        contentType = request.headers.get('content-type') ?? '';
        return HttpResponse.json(
          envelope({
            key: 'video/2026/11/12/00000000-0000-0000-0000-000000000001.mp4',
            url: 'http://localhost:3000/api/v1/files/media?key=x&exp=1&sig=y',
            mimeType: 'video/mp4',
            size: 4,
          }),
          { status: 201 },
        );
      }),
    );

    const result = await uploadMedia(videoFile(), 'video');

    expect(contentType).toContain('multipart/form-data');
    expect(result.key).toContain('video/');
    expect(result.mimeType).toBe('video/mp4');
    expect(result.size).toBe(4);
  });

  it('音频上传走 audio 接口', async () => {
    // 记录命中的路径
    let path = '';
    server.use(
      http.post(/\/api\/v1\/admin\/files\/audio$/, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json(
          envelope({
            key: 'audio/2026/11/12/00000000-0000-0000-0000-000000000002.mp3',
            url: 'http://localhost:3000/api/v1/files/media?key=y&exp=1&sig=z',
            mimeType: 'audio/mpeg',
            size: 4,
          }),
          { status: 201 },
        );
      }),
    );

    const result = await uploadMedia(
      new File(['test'], 'a.mp3', { type: 'audio/mpeg' }),
      'audio',
    );

    expect(path).toBe('/api/v1/admin/files/audio');
    expect(result.mimeType).toBe('audio/mpeg');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd frontend && npx vitest run tests/unit/validators.test.ts tests/api/files.test.ts`

Expected: FAIL，`isAllowedMedia` 与 `uploadMedia` 未导出。

- [ ] **Step 3: 实现校验器与上传 API**

在 `frontend/src/lib/validators.ts` 末尾追加：

```ts
// 媒体大类：视频或音频
export type MediaKind = 'video' | 'audio';
// 视频允许的 MIME
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
// 音频允许的 MIME
export const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a'];
// 视频允许的扩展名
const VIDEO_EXTENSIONS = ['.mp4', '.webm'];
// 音频允许的扩展名
const AUDIO_EXTENSIONS = ['.mp3', '.m4a'];
// 音频上限 100MB
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
// 视频上限 1GB
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

// 判断文件名是否以允许的扩展名结尾
function hasExtension(file: File, extensions: string[]): boolean {
  const name = file.name.toLowerCase();
  return extensions.some((extension) => name.endsWith(extension));
}

// 上传前预检媒体：类型、扩展名与大小，服务端仍是最终门槛
export function isAllowedMedia(file: File, kind: MediaKind): boolean {
  const limit = kind === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
  if (file.size <= 0 || file.size > limit) return false;
  if (kind === 'video') {
    return (
      ALLOWED_VIDEO_TYPES.includes(file.type) ||
      hasExtension(file, VIDEO_EXTENSIONS)
    );
  }
  return (
    ALLOWED_AUDIO_TYPES.includes(file.type) ||
    hasExtension(file, AUDIO_EXTENSIONS)
  );
}
```

把 `frontend/src/api/files.ts` 整体替换为：

```ts
import type { MediaKind } from '@/lib/validators';
import { request } from './client';

// 图片上传返回：key 持久化，url 立即用于展示
export interface UploadResult {
  key: string;
  url: string;
}

// 媒体上传返回：key 持久化，url 为短期签名播放地址
export interface MediaUploadResult {
  key: string;
  url: string;
  mimeType: string;
  size: number;
}

// 媒体上传可选参数
export interface UploadMediaOptions {
  onProgress?: (percent: number) => void; // 上传进度回调
  signal?: AbortSignal; // 取消信号
}

// 图片上传：PNG/JPEG/WebP，单张 ≤2MB 由前端预检 + 后端复核
export function uploadImage(file: File): Promise<UploadResult> {
  // 上传走 multipart/form-data，交给浏览器生成 boundary
  const formData = new FormData();
  formData.append('file', file);
  return request<UploadResult>({
    url: '/files/upload',
    method: 'POST',
    data: formData,
  });
}

// 音视频上传：仅管理员，走 /admin/files/{kind}
export function uploadMedia(
  file: File,
  kind: MediaKind,
  options: UploadMediaOptions = {},
): Promise<MediaUploadResult> {
  // 上传走 multipart/form-data，交给浏览器生成 boundary
  const formData = new FormData();
  formData.append('file', file);
  return request<MediaUploadResult>({
    url: `/admin/files/${kind}`,
    method: 'POST',
    data: formData,
    signal: options.signal,
    onUploadProgress: (event) => {
      // 无总长度或未提供回调时跳过
      if (!options.onProgress || !event.total) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      options.onProgress(Math.min(100, Math.max(0, percent)));
    },
  });
}
```

- [ ] **Step 4: 运行测试与类型检查**

Run: `cd frontend && npx vitest run tests/unit/validators.test.ts tests/api/files.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/lib/validators.ts frontend/src/api/files.ts frontend/tests/unit/validators.test.ts frontend/tests/api/files.test.ts
git commit -m "feat(frontend): 媒体上传 API 与前端校验"
```

---

### 任务 9：媒体上传组件与章节接入

**Files:**
- Create: `frontend/src/components/common/MediaUploader.tsx`
- Test: `frontend/tests/components/media-uploader.test.tsx`
- Modify: `frontend/src/features/admin/courses/ChapterPanel.tsx`
- Modify: `frontend/src/features/learning/ChapterViewer.tsx`

**Interfaces:**
- Consumes: `uploadMedia`、`isAllowedMedia`、`MediaKind`。
- Produces:
  - `<MediaUploader kind value onChange disabled />`
  - 章节弹窗视频/音频使用上传组件，表单值仍为 key 字符串。

- [ ] **Step 1: 写组件失败测试**

创建 `frontend/tests/components/media-uploader.test.tsx`：

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { MediaUploader } from '@/components/common/MediaUploader';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-media' };
}

describe('MediaUploader', () => {
  it('选择合法视频后上传并回传 key', async () => {
    // 记录接口是否被调用
    let called = false;
    server.use(
      http.post(/\/api\/v1\/admin\/files\/video$/, () => {
        called = true;
        return HttpResponse.json(
          envelope({
            key: 'video/2026/11/12/x.mp4',
            url: 'http://media.test/v.mp4',
            mimeType: 'video/mp4',
            size: 4,
          }),
          { status: 201 },
        );
      }),
    );

    const onChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <MediaUploader kind="video" onChange={onChange} />
      </AntdApp>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['test'], 'a.mp4', { type: 'video/mp4' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('video/2026/11/12/x.mp4'));
    expect(called).toBe(true);
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('不支持的类型不发起上传', async () => {
    // 记录接口是否被调用
    let called = false;
    server.use(
      http.post(/\/api\/v1\/admin\/files\/video$/, () => {
        called = true;
        return HttpResponse.json(envelope({}));
      }),
    );

    const onChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <MediaUploader kind="video" onChange={onChange} />
      </AntdApp>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['test'], 'a.mkv', { type: 'video/x-matroska' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/视频仅支持 MP4\/WebM/)).toBeInTheDocument();
    expect(called).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd frontend && npx vitest run tests/components/media-uploader.test.tsx`

Expected: FAIL，找不到 `MediaUploader`。

- [ ] **Step 3: 实现组件并接入章节**

创建 `frontend/src/components/common/MediaUploader.tsx`：

```tsx
import { App as AntdApp, Button, Progress, Space, Typography } from 'antd';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { uploadMedia } from '@/api/files';
import { isAllowedMedia, type MediaKind } from '@/lib/validators';

// 媒体上传：预检、进度、取消与即时预览；表单只保存 key
export function MediaUploader({
  kind,
  value,
  onChange,
  disabled,
}: {
  kind: MediaKind; // 视频或音频
  value?: string | null; // 已保存的 key
  onChange?: (key: string | null) => void; // key 变化回调
  disabled?: boolean; // 只读态
}) {
  // AntD 消息
  const { message } = AntdApp.useApp();
  // 隐藏的文件选择器
  const inputRef = useRef<HTMLInputElement>(null);
  // 当前上传的取消控制器
  const abortRef = useRef<AbortController | null>(null);
  // 是否正在上传
  const [uploading, setUploading] = useState(false);
  // 上传进度百分比
  const [percent, setPercent] = useState(0);
  // 本次上传的预览地址
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 本次选择的文件名
  const [fileName, setFileName] = useState<string | null>(null);
  // 文案：视频/音频
  const label = kind === 'video' ? '视频' : '音频';

  useEffect(() => {
    // 外部清空 key 时同步清空预览
    if (!value) {
      setPreviewUrl(null);
      setFileName(null);
    }
  }, [value]);

  // 选择文件：预检后上传，成功后回传 key
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!isAllowedMedia(file, kind)) {
      message.error(
        kind === 'video'
          ? '视频仅支持 MP4/WebM，且不超过 1GB'
          : '音频仅支持 MP3/M4A，且不超过 100MB',
      );
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setPercent(0);
    setFileName(file.name);
    try {
      const result = await uploadMedia(file, kind, {
        signal: controller.signal,
        onProgress: setPercent,
      });
      setPreviewUrl(result.url);
      onChange?.(result.key);
      message.success('上传成功');
    } catch (error) {
      // 用户主动取消不算失败
      if (controller.signal.aborted) {
        message.info('已取消上传');
        return;
      }
      message.error(error instanceof Error ? error.message : '上传失败');
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  }

  // 取消上传
  function cancelUpload() {
    abortRef.current?.abort();
  }

  // 清除已上传内容
  function clear() {
    setPreviewUrl(null);
    setFileName(null);
    onChange?.(null);
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {previewUrl ? (
        kind === 'video' ? (
          <video
            key={previewUrl}
            controls
            preload="metadata"
            src={previewUrl}
            style={{ width: '100%', maxHeight: 320 }}
          />
        ) : (
          <audio key={previewUrl} controls src={previewUrl} style={{ width: '100%' }} />
        )
      ) : (
        <Typography.Text type="secondary">
          {value ? `已选择${label}；编辑模式不加载旧媒体预览` : `尚未上传${label}`}
        </Typography.Text>
      )}
      {fileName && <Typography.Text type="secondary">{fileName}</Typography.Text>}
      {uploading && <Progress percent={percent} size="small" />}
      <Space>
        <Button
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {value ? `更换${label}` : `上传${label}`}
        </Button>
        {uploading && (
          <Button danger onClick={cancelUpload}>
            取消上传
          </Button>
        )}
        {value && !uploading && (
          <Button type="link" danger disabled={disabled} onClick={clear}>
            清除
          </Button>
        )}
      </Space>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={
          kind === 'video'
            ? 'video/mp4,video/webm,.mp4,.webm'
            : 'audio/mpeg,audio/mp4,.mp3,.m4a'
        }
        onChange={handleFileChange}
      />
    </Space>
  );
}
```

修改 `frontend/src/features/admin/courses/ChapterPanel.tsx`：

1. 在 import 中加入：

```ts
import { MediaUploader } from '@/components/common/MediaUploader';
```

2. 把正文 Form.Item 的 `extra` 与子组件替换为：

```tsx
          <Form.Item
            name="content"
            label="正文"
            extra={
              editing
                ? '留空保持原正文不变，填写则整体替换'
                : '可选；图文为富文本，视频/音频先上传再保存'
            }
          >
            {courseType === 'rich' ? (
              <RichTextEditor placeholder="留空保持原正文不变" />
            ) : (
              <MediaUploader kind={courseType} />
            )}
          </Form.Item>
```

修改 `frontend/src/features/learning/ChapterViewer.tsx`，给视频加 `preload="metadata"`：

```tsx
      <video
        key={content.content}
        controls
        preload="metadata"
        style={{ width: '100%', maxHeight: 480 }}
        src={content.content}
      />
```

- [ ] **Step 4: 运行组件测试、类型检查与 lint**

Run: `cd frontend && npx vitest run tests/components/media-uploader.test.tsx && npm run typecheck && npm run lint`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/common/MediaUploader.tsx frontend/tests/components/media-uploader.test.tsx frontend/src/features/admin/courses/ChapterPanel.tsx frontend/src/features/learning/ChapterViewer.tsx
git commit -m "feat(frontend): 章节视频音频改用上传组件"
```

---

### 任务 10：OpenAPI 契约与生成类型

**Files:**
- Modify: `backend/openapi.yaml`
- Regenerate: `frontend/src/api/schema.d.ts`

**Interfaces:**
- Consumes: 任务 5 的路由与任务 8 的返回结构。
- Produces: `MediaUploadData` schema、`/files/media`、`/admin/files/{video|audio}`。

- [ ] **Step 1: 修改 openapi.yaml**

在 `ChapterContent.content` 处替换描述：

```yaml
        content: { type: string, nullable: true, description: rich=净化后 HTML（img 的 src 已换公开 URL、保留 data-key）；video/audio=短期签名播放 URL；旧 key 无法解析时为 null }
```

把 `UploadData` 替换为：

```yaml
    UploadData:
      type: object
      description: data 结构：图片上传结果
      properties:
        key: { type: string, description: 图片 key（image/YYYY/MM/DD/uuid.ext），前端应持久化该值 }
        url: { type: string, description: 公开访问 URL（PUBLIC_BASE_URL + /uploadFiles/ + key） }
    MediaUploadData:
      type: object
      description: data 结构：音视频上传结果
      properties:
        key: { type: string, description: 媒体 key（video|audio/YYYY/MM/DD/uuid.ext） }
        url: { type: string, description: 短期签名播放 URL，默认 4 小时 }
        mimeType: { type: string, description: 服务端识别的标准 MIME }
        size: { type: integer, description: 文件字节数 }
```

把 `ChapterCreateRequest.content` 的描述替换为：

```yaml
        content: { type: string, nullable: true, description: rich=HTML（图片建议带 data-key）；video/audio=媒体上传接口返回的 key }
```

把 `CourseDetail.detailRich` 的描述替换为：

```yaml
            detailRich: { type: string, nullable: true, description: 服务端净化后的富文本；图片 src 已重写为公开 URL，data-key 保留 }
```

图片相关字段描述统一按“公开 URL / 本地图片 key”改写，涉及：

- 提交字段（3 处）：`ProfileUpdateRequest.avatarUrl`、`CourseCreateRequest.coverUrl`、`CourseUpdateRequest.coverUrl`，描述改为 `提交图片 key（image/YYYY/MM/DD/uuid.ext，兼容历史 http(s) URL）`；`ProfileUpdateRequest.avatarUrl` 保留“传 null 清空”。
- key 字段（4 处）：`User.avatarKey`、`CourseBrief.coverKey`、`PostBrief.avatarKey`、`ProfileData.avatarKey`，把“对象存储 key”改为“头像/封面图片 key（image/YYYY/MM/DD/uuid.ext）；历史 http(s) 数据为 null”。
- 响应 URL 字段（4 处）：`User.avatarUrl`、`CourseBrief.coverUrl`、`PostBrief.avatarUrl`、`ProfileData.avatarUrl`，描述改为 `key 返回公开 URL（PUBLIC_BASE_URL + /uploadFiles/ + key），历史 http(s) 原样返回`。
- 富文本 `src` 描述（3 处）：`ReplyView.content`、`CommentView.content`、`PostBrief.content`，把“img 的 src 已换签名 URL”改为“img 的 src 已换公开 URL”。

把 `/files/upload` 的 summary 替换为：

```yaml
      summary: 图片上传（PNG/JPEG/WebP，单张 ≤2MB；magic bytes 校验 + 重编码，存储至本地 public/image）
```

在 `/files/upload` 路径之后追加：

```yaml
  /files/media:
    get:
      tags: [files]
      summary: 媒体读取（签名授权，支持 Range/206；不要求登录）
      security: []
      parameters:
        - name: key
          in: query
          required: true
          schema: { type: string }
        - name: exp
          in: query
          required: true
          schema: { type: integer, description: 过期时间（Unix 秒） }
        - name: sig
          in: query
          required: true
          schema: { type: string, description: base64url HMAC-SHA256 签名 }
      responses:
        '200':
          description: 媒体内容；带 Range 请求时可能返回 206
          content:
            application/octet-stream:
              schema: { type: string, format: binary }
        '403': { $ref: '#/components/responses/Err403' }
        '404': { $ref: '#/components/responses/Err404' }

  /admin/files/video:
    post:
      tags: [files]
      summary: 上传视频（仅管理员，MP4/WebM，默认 ≤1GB，流式落盘）
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file: { type: string, format: binary }
      responses:
        '201':
          description: 'data: MediaUploadData'
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Envelope' }
        '400': { $ref: '#/components/responses/Err400' }
        '401': { $ref: '#/components/responses/Err401' }
        '403': { $ref: '#/components/responses/Err403' }
        '422':
          description: 容器不支持/与接口不符/超过上限
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Envelope' }
        '429': { $ref: '#/components/responses/Err429' }

  /admin/files/audio:
    post:
      tags: [files]
      summary: 上传音频（仅管理员，MP3/M4A，默认 ≤100MB，流式落盘）
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file: { type: string, format: binary }
      responses:
        '201':
          description: 'data: MediaUploadData'
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Envelope' }
        '400': { $ref: '#/components/responses/Err400' }
        '401': { $ref: '#/components/responses/Err401' }
        '403': { $ref: '#/components/responses/Err403' }
        '422':
          description: 容器不支持/与接口不符/超过上限
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Envelope' }
        '429': { $ref: '#/components/responses/Err429' }
```

- [ ] **Step 2: 重新生成前端类型**

Run: `cd frontend && npm run gen:api`

Expected: `frontend/src/api/schema.d.ts` 出现 `MediaUploadData`、`/files/media`、`/admin/files/video`、`/admin/files/audio`。

- [ ] **Step 3: 验证 OpenAPI 可解析且前端类型通过**

Run:

```bash
cd frontend && npm run typecheck
cd frontend && git diff --stat src/api/schema.d.ts
```

Expected: typecheck PASS；生成文件有变更。

- [ ] **Step 4: 提交**

```bash
git add backend/openapi.yaml frontend/src/api/schema.d.ts
git commit -m "docs(api): 本地图片与媒体上传契约"
```

---

### 任务 11：清理 MinIO 依赖、种子与文档

**Files:**
- Modify: `backend/package.json`（移除 AWS SDK，更新描述）
- Modify: `backend/package-lock.json`（由 npm 生成）
- Modify: `backend/.env.example`
- Modify: `backend/.gitignore`
- Modify: `backend/prisma/seed-data.ts`
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/test/integration/admin-catalog.spec.ts`
- Modify: `backend/test/integration/catalog.spec.ts`
- Modify: `backend/src/catalog/chapter.admin.service.ts`
- Modify: `backend/src/catalog/course.service.ts`
- Modify: `backend/src/catalog/dto/create-chapter.dto.ts`
- Modify: `backend/src/catalog/dto/update-chapter.dto.ts`
- Modify: `backend/src/auth/auth.service.ts`
- Modify: `backend/src/users/users.service.ts`
- Modify: `backend/src/community/post/post.service.ts`
- Modify: `backend/src/common/utils/media.util.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `frontend/src/components/common/ImageUploader.tsx`
- Modify: `frontend/src/components/common/RichTextEditor.tsx`
- Modify: `frontend/src/lib/image-url.ts`
- Modify: `backend/目录结构.md`
- Modify: `frontend/前端设计框架.md`
- Modify: `backend/实施计划/13-文件上传与对象存储.md`

**Interfaces:**
- Consumes: 前序任务全部完成。
- Produces: 仓库内不再有 MinIO 运行时依赖与旧 key 种子。

- [ ] **Step 1: 种子与注释改为本地 key 语义**

把 `backend/prisma/seed-data.ts` 中 `COURSE_TYPESCRIPT.chapters` 替换为：

```ts
  chapters: [
    // 章节正文由管理员上传媒体后写入；种子不指向不存在的文件
    { title: '第一章 类型基础', content: null },
    { title: '第二章 泛型进阶', content: null },
  ],
```

把 `backend/prisma/schema.prisma` 中 `Chapter.content` 注释改为：

```prisma
  content     String?    @db.Text // rich: 净化后 HTML；video/audio: 媒体 key（video|audio/YYYY/MM/DD/uuid.ext）
```

种子章节 `content` 置空后，`backend/test/integration/catalog.spec.ts` 第 140 行“content 为真值”的断言会失败。把它改为：

```ts
    // 种子章节不指向不存在的媒体文件，正文读取成功但内容为空
    expect(res.body.data.content).toBeNull();
```

把 `backend/test/integration/admin-catalog.spec.ts` 第 87 行的旧 key `videos/a.mp4` 改为新格式（文件无需真实存在，服务端一期不校验）：

```ts
      .send({
        title: '第一节',
        contentType: 'video',
        content: 'video/2026/11/12/00000000-0000-0000-0000-000000000001.mp4',
      })
```

把 `backend/src/catalog/chapter.admin.service.ts` 中“非图文类型内容为对象存储 key，原样保存”改为：

```ts
    // 非图文类型内容为媒体 key，原样保存（一期不校验文件是否存在）
```

把 `backend/src/catalog/dto/create-chapter.dto.ts` 与 `update-chapter.dto.ts` 中“video/audio 为对象存储 key”改为“video/audio 为媒体 key”。

把 `backend/src/app.module.ts` 中 `StorageModule` 的注释改为：

```ts
    StorageModule, // 本地文件上传与媒体签名
```

把以下残留“对象存储”注释统一改为“本地存储/图片/媒体 key”语义（逐文件逐行替换）：

- `backend/prisma/seed-data.ts` 第 40 行：`content 为媒体 key（视频课）`。
- `backend/prisma/seed.ts` 第 142、148 行：`content: chapter.content, // 媒体 key`。
- `backend/src/catalog/course.service.ts` 第 25 行改为 `封面图片 key`；第 26 行改为 `封面展示地址（key 为公开 URL，历史 http 原样）`；第 89 行改为 `正文（rich HTML / 媒体 key）`；第 145 行改为 `构造函数：注入 Prisma 与本地存储服务`；第 265 行改为 `富文本图片读取时重写为公开地址`；第 346 行改为 `正文按类型解析：富文本图片换公开地址，视频/音频 key 换签名地址，历史 http 原样`。
- `backend/src/auth/auth.service.ts` 第 39 行改为 `头像图片 key（历史 http 数据为 null）`；第 40 行改为 `头像展示地址（key 为公开 URL，历史 http 原样）`。
- `backend/src/users/users.service.ts` 第 16 行改为 `头像图片 key（历史 http 数据为 null）`；第 17 行改为 `头像展示地址（key 为公开 URL，历史 http 原样）`。
- `backend/src/community/post/post.service.ts` 第 19 行改为 `作者头像图片 key（历史 http 数据为 null）`；第 20 行改为 `作者头像展示地址（key 为公开 URL）`；第 21 行改为 `净化后的内容（图片已换公开地址）`。
- `backend/src/common/utils/media.util.ts` 第 9 行改为 `判断字符串是否为本地存储 key`；第 51 行改为 `将富文本图片的 src 重写为解析后的地址`；第 75 行改为 `未收集到解析地址时保持原状`。

前端图片相关注释同步改为“公开 URL”（音视频仍为“签名地址”）：

- `frontend/src/components/common/ImageUploader.tsx` 第 24 行改为 `预览地址：优先用上传返回的公开 URL，其次尝试 key 本身是否为 http(s)`。
- `frontend/src/components/common/RichTextEditor.tsx` 第 15 行改为 `带 data-key 的图片扩展：保存 key，展示公开 URL`；第 73 行改为 `避免父组件回写 key 化 HTML 时把公开 URL 覆盖掉`。
- `frontend/src/lib/image-url.ts` 第 1 行改为 `是否本地存储 key（非 http(s)）`；第 6 行改为 `统一取展示地址：服务端返回的公开 URL 优先，其次历史 http(s) URL，key 无地址时返回 undefined`。

- [ ] **Step 2: 环境变量与 gitignore**

把 `backend/.env.example` 中的 `MINIO_*` 块替换为：

```dotenv
# 上传根目录：生产必须挂载持久卷；默认 <backend 工作目录>/uploadFiles
UPLOAD_DIR=
# 生成图片/媒体 URL 的公开源（末尾斜杠会自动去除）
PUBLIC_BASE_URL=http://localhost:3000
# 媒体 URL 签名密钥；留空时复用 SESSION_SECRET
UPLOAD_SIGNING_SECRET=
# 单文件上限（MB）：音频默认 100，视频默认 1024
UPLOAD_AUDIO_MAX_MB=100
UPLOAD_VIDEO_MAX_MB=1024
# 媒体签名 URL 有效期（秒），默认 4 小时
UPLOAD_MEDIA_TTL_SECONDS=14400
# 生产设置后由 Nginx X-Accel-Redirect 发送文件，如 /_protected_media/
UPLOAD_X_ACCEL_PREFIX=
```

在 `backend/.gitignore` 末尾追加：

```text
uploadFiles/
```

- [ ] **Step 3: 移除依赖并更新描述**

Run:

```bash
cd backend
npm uninstall @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm uninstall testcontainers @testcontainers/postgresql @testcontainers/redis
```

`testcontainers` 三个包在任务 7 后已无任何引用（集成测试统一用 CI 服务与临时目录），一并移除。

把 `backend/package.json` 的 `description` 改为：

```json
  "description": "知序课堂后端（NestJS + Prisma + PostgreSQL + Redis + 本地文件存储）",
```

- [ ] **Step 4: 更新文档**

`backend/目录结构.md`：

- 第 3 行技术栈中的 `MinIO` 改为 `本地文件存储`。
- 第 26 行 `storage/` 行注释改为 `本地文件存储：图片落盘/媒体签名/上传接口`。
- 第 81 行环境变量列表中的 `MINIO_*` 改为 `UPLOAD_*`。
- 第 84 行 `.env.example` 关键项中的 `MINIO_*` 改为 `UPLOAD_DIR`、`PUBLIC_BASE_URL`、`UPLOAD_SIGNING_SECRET`、`UPLOAD_AUDIO_MAX_MB`、`UPLOAD_VIDEO_MAX_MB`、`UPLOAD_MEDIA_TTL_SECONDS`、`UPLOAD_X_ACCEL_PREFIX`。
- 第 108 行依赖清单中的 `@aws-sdk/client-s3` 改为 Node 内置 `fs/promises` 与 `crypto`。

`frontend/前端设计框架.md`：

- 第 87 行“对象存储 key”改为“图片/媒体 key”。
- 第 328 行段落的“后端读取时签名”改为“图片给公开 URL、音视频给短期签名 URL”。
- 第 333 行返回说明改为“图片 url 为公开地址（PUBLIC_BASE_URL + /uploadFiles/ + key）；音视频 url 为默认 4 小时签名地址”。
- 第 341–344 行表格中的“签名 URL”按类型区分：`coverUrl`、`avatarUrl`、富文本图片 `src` 改为“公开 URL”；视频/音频章节 `content` 保持“签名 URL”。
- 第 346 行兼容规则改为“历史 http(s) 数据原样返回，不重写、不报错”。
- 第 353–356 行读取路径说明改为“图片重写为公开 URL、音视频生成短期签名 URL”，并删除“15 分钟/建议 1 小时”的旧 TTL 描述，统一为“默认 4 小时，`UPLOAD_MEDIA_TTL_SECONDS` 可配”。
- 第 361、559 行“签名过期导致裂图/重取”只保留给音视频；图片为公开地址，不存在签名过期。
- 第 698 行接口表增加 `POST /admin/files/video`、`POST /admin/files/audio`、`GET /files/media`。

`backend/实施计划/13-文件上传与对象存储.md` 第 2 行后插入：

```markdown
> 历史方案：MinIO 私有桶已被 [本地文件与媒体上传设计](../../docs/superpowers/specs/2026-11-12-local-media-upload-design.md) 取代，本文仅保留为决策记录。
```

部署说明以设计文档 §11 为准：本仓库没有 Nginx 配置目录，执行时不新增配置文件；上线前按 §11 配置 `client_max_body_size`、`proxy_request_buffering off`、公开图片 alias、`/_protected_media/` internal alias、持久卷与备份。

- [ ] **Step 5: 全量验证**

Run:

```bash
cd backend && npm run lint && npm run build && npm test
cd frontend && npm run lint && npm run typecheck && npm test
```

Expected: 全部 PASS。

再运行：

```bash
grep -rn "MINIO_\|@aws-sdk\|testcontainers" backend/src backend/test backend/package.json backend/.env.example
grep -rn "signRichHtml" backend/src backend/test
```

Expected: 两条命令均无输出。

集成测试验证：

```bash
cd backend && npm run test:all
```

Expected: CI 中全部 PASS。本机若没有 Postgres/Redis，需先启动服务；若未执行，必须在提交说明和最终汇报中注明“集成测试未在本机运行，仅由 CI 验证”。

- [ ] **Step 6: 提交**

```bash
git add backend/package.json backend/package-lock.json backend/.env.example backend/.gitignore backend/prisma/seed-data.ts backend/prisma/seed.ts backend/prisma/schema.prisma backend/test/integration/admin-catalog.spec.ts backend/test/integration/catalog.spec.ts backend/src/catalog/chapter.admin.service.ts backend/src/catalog/course.service.ts backend/src/catalog/dto/create-chapter.dto.ts backend/src/catalog/dto/update-chapter.dto.ts backend/src/auth/auth.service.ts backend/src/users/users.service.ts backend/src/community/post/post.service.ts backend/src/common/utils/media.util.ts backend/src/app.module.ts frontend/src/components/common/ImageUploader.tsx frontend/src/components/common/RichTextEditor.tsx frontend/src/lib/image-url.ts backend/目录结构.md frontend/前端设计框架.md backend/实施计划/13-文件上传与对象存储.md
git commit -m "chore: 移除 MinIO 运行时依赖并更新本地存储文档"
```

---

## 验收对照

| 设计文档要求 | 对应任务 |
| --- | --- |
| 本地 `uploadFiles` 按类型/日期分目录 | 4、5 |
| 图片上传返回公开地址 | 1、4、7 |
| 音视频流式落盘、禁止整文件进内存 | 5、4 |
| 媒体签名 URL + Range/206 | 3、4、5、7 |
| Nginx X-Accel-Redirect | 4、5、11 |
| 上传角色限制 | 5、7 |
| 前端媒体上传与章节接入 | 8、9 |
| OpenAPI 与生成类型一致 | 10 |
| 移除 MinIO 运行时依赖 | 11 |
| 旧 key 不再透传 | 4、7、11 |
| 持久卷、Nginx 体积/Range/缓存、备份要求 | 设计文档 §11（本仓库无部署配置，执行时按 §11 落地） |
