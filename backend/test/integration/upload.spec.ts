import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import request from 'supertest';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import { DEMO_USER } from '../../prisma/seed-data';

jest.setTimeout(180_000);

// 1x1 真实 PNG（sharp 可解码），用于正常上传用例
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('文件上传（CI 集成，MinIO 容器）', () => {
  // Nest 应用实例
  let app: INestApplication;
  // MinIO 容器
  let minio: StartedTestContainer;
  // MinIO 访问端点（宿主机映射端口）
  let endpoint: string;
  // 私有桶名称
  const bucket = 'zhixu';

  beforeAll(async () => {
    // 启动 MinIO（S3 兼容），等待健康检查通过
    minio = await new GenericContainer('minio/minio:latest')
      .withEnvironment({
        MINIO_ROOT_USER: 'minioadmin',
        MINIO_ROOT_PASSWORD: 'minioadmin',
      })
      .withCommand(['server', '/data'])
      .withExposedPorts(9000)
      .withWaitStrategy(
        Wait.forHttp('/minio/health/live', 9000).withStartupTimeout(120_000),
      )
      .start();
    // 拼接宿主机可访问端点
    endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;

    // 必须在导入 AppModule 前写入存储配置：ConfigModule 在模块加载时执行 loadConfig
    process.env.MINIO_ENDPOINT = endpoint;
    process.env.MINIO_ACCESS_KEY = 'minioadmin';
    process.env.MINIO_SECRET_KEY = 'minioadmin';
    process.env.MINIO_BUCKET = bucket;
    process.env.MINIO_PUBLIC_URL = `${endpoint}/${bucket}`;

    // 动态导入：确保 AppModule 读取到容器端点
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    const config = loadConfig();
    const redis = app.get(RedisService);
    // 与 main.ts 一致：路由注册前挂载会话中间件
    app.use(sessionMiddleware(config, () => redis.getClient()));
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
    await minio?.stop();
    // 清理存储环境变量，避免影响同进程内的其他测试文件
    delete process.env.MINIO_ENDPOINT;
    delete process.env.MINIO_ACCESS_KEY;
    delete process.env.MINIO_SECRET_KEY;
    delete process.env.MINIO_BUCKET;
    delete process.env.MINIO_PUBLIC_URL;
  });

  // 登录演示学员，返回带会话的 supertest agent
  async function login() {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: DEMO_USER.email, password: DEMO_USER.password })
      .expect(200);
    return agent;
  }

  it('上传合法 PNG → 返回 key/签名 url；直接 GET 签名 url 可访问', async () => {
    const a = await login();
    const res = await a
      .post('/api/v1/files/upload')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);

    const { key, url } = res.body.data as { key: string; url: string };
    expect(key).toContain('.png');
    expect(url).toContain('X-Amz-Signature');

    // 签名 URL 可读取（私有桶的临时授权）
    const fetched = await fetch(url);
    expect(fetched.status).toBe(200);

    // 无签名直连被拒（私有桶）
    const raw = await fetch(`${endpoint}/${bucket}/${key}`);
    expect(raw.status).toBe(403);
  });

  it('伪造扩展名（文本改名 .png）422', async () => {
    const a = await login();
    const res = await a
      .post('/api/v1/files/upload')
      .attach('file', Buffer.from('not an image'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(422);
    expect(res.body.code).toBe(1001);
  });

  it('超 2MB 422', async () => {
    const a = await login();
    const res = await a
      .post('/api/v1/files/upload')
      .attach('file', Buffer.alloc(2 * 1024 * 1024 + 1, 1), {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(422);
    expect(res.body.code).toBe(1001);
  });

  it('未登录 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/files/upload')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(401);
    expect(res.body.code).toBe(2001);
  });
});
