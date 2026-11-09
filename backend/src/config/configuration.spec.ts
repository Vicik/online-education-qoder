import { loadConfig } from './configuration';

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
  'MINIO_ENDPOINT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_BUCKET',
  'MINIO_PUBLIC_URL',
];

describe('loadConfig', () => {
  const original = { ...process.env };

  beforeEach(() => {
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
    process.env.MINIO_BUCKET = 'custom-bucket';

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
    expect(cfg.minio.bucket).toBe('custom-bucket');
  });

  it('未设可选项时取默认值', () => {
    const cfg = loadConfig();
    expect(cfg.sessionTtl).toBe(86400);
    expect(cfg.jobScanIntervalSeconds).toBe(60);
    expect(cfg.corsOrigins).toEqual([]);
    expect(cfg.seedDemoData).toBe(false);
    expect(cfg.minio).toEqual({
      endpoint: '',
      accessKey: '',
      secretKey: '',
      bucket: 'zhixu',
      publicUrl: '',
    });
  });

  it('SEED_DEMO_DATA 非 true 字面量时视为 false', () => {
    process.env.SEED_DEMO_DATA = '1';
    expect(loadConfig().seedDemoData).toBe(false);
  });
});
