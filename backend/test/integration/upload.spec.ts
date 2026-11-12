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
