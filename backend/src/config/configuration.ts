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
