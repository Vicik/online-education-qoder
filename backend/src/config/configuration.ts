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
  minio: {
    // MinIO 对象存储配置
    endpoint: string; // MinIO 服务端点
    accessKey: string; // MinIO 访问密钥
    secretKey: string; // MinIO 密钥
    bucket: string; // MinIO 存储桶名称
    publicUrl: string; // MinIO 公开访问 URL
  };
}

// 加载配置函数：从环境变量读取配置，缺失必需变量时抛出异常
export function loadConfig(): AppConfig {
  // 必需的环境变量列表
  const required = ['DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET'];
  // 检查必需环境变量是否存在
  for (const key of required) {
    if (!process.env[key]) throw new Error(`缺少环境变量 ${key}`);
  }

  // 返回配置对象
  return {
    databaseUrl: process.env.DATABASE_URL!, // 数据库连接 URL
    redisUrl: process.env.REDIS_URL!, // Redis 连接 URL
    sessionSecret: process.env.SESSION_SECRET!, // 会话加密密钥
    sessionTtl: Number(process.env.SESSION_TTL ?? 86400), // 会话过期时间，默认 24 小时
    orderPendingTtlMinutes: Number(process.env.ORDER_PENDING_TTL_MINUTES ?? 15), // 订单待支付超时，默认 15 分钟
    jobScanIntervalSeconds: Number(process.env.JOB_SCAN_INTERVAL_SECONDS ?? 60), // 任务扫描间隔，默认 60 秒
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean), // CORS 允许的来源列表
    bcryptCost: Number(process.env.BCRYPT_COST ?? 12), // bcrypt 成本因子，默认 12
    seedDemoData: process.env.SEED_DEMO_DATA === 'true', // 是否初始化演示数据
    minio: {
      endpoint: process.env.MINIO_ENDPOINT ?? '', // MinIO 端点
      accessKey: process.env.MINIO_ACCESS_KEY ?? '', // MinIO 访问密钥
      secretKey: process.env.MINIO_SECRET_KEY ?? '', // MinIO 密钥
      bucket: process.env.MINIO_BUCKET ?? 'zhixu', // MinIO 存储桶，默认 zhixu
      publicUrl: process.env.MINIO_PUBLIC_URL ?? '', // MinIO 公开 URL
    },
  };
}
