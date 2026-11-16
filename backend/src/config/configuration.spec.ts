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
    expect(cfg.sessionTtl).toBe(1800);
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
