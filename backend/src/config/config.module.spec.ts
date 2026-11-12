import { ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppConfigModule } from './config.module';

@Module({})
class ConsumerModule {
  constructor(readonly config: ConfigService) {}
}

describe('AppConfigModule', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://x';
    process.env.REDIS_URL = 'redis://x';
    process.env.SESSION_SECRET = 's3cret';
    delete process.env.BCRYPT_COST;
    delete process.env.UPLOAD_DIR;
    delete process.env.PUBLIC_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...original };
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

  it('全局注册：未导入配置模块的模块也能注入 ConfigService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, ConsumerModule],
    }).compile();

    expect(moduleRef.get(ConsumerModule).config.get('redisUrl')).toBe(
      'redis://x',
    );
  });
});
