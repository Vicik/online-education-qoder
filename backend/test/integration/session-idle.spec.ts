import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { SESSION_KEY_PREFIX } from '../../src/auth/session.constants';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';

// 本文件使用的学员账号（每次运行唯一）
const TEST_EMAIL = `sidle-${Date.now()}@test.com`;
// 测试密码
const TEST_PASSWORD = 'Passw0rd1';

// 从 Set-Cookie 中解析 express-session 的 sessionId（s:<sid>.<signature>）
function sessionIdFrom(setCookie: string | string[] | undefined): string {
  // 取第一条 Cookie
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('登录响应缺少 Set-Cookie');
  // Cookie 值形如 connect.sid=s%3A<sid>.<sig>
  const value = raw.split(';')[0].split('=').slice(1).join('=');
  // 解码 s:<sid>.<sig> 并取出 sid
  return decodeURIComponent(value).slice(2).split('.')[0];
}

// 等待毫秒
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('会话空闲失效（CI 集成）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: Redis;
  let expectedTtl: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    const config = loadConfig();
    expectedTtl = config.sessionTtl;
    const redisService = app.get(RedisService);
    // 与 main.ts 一致：路由注册前挂载会话中间件
    app.use(sessionMiddleware(config, () => redisService.getClient()));
    app.useGlobalPipes(
      new TrimmingValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    // 客户端在 onModuleInit 中创建，必须等应用初始化完成后再取
    redis = redisService.getClient();

    prisma = new PrismaClient();
    // 准备独立账号，避免与其他用例的限流计数互相影响
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        confirmPassword: TEST_PASSWORD,
        nickname: '空闲测试',
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // 登录并返回带 Cookie 的 agent 与 sessionId
  async function login() {
    const agent = request.agent(app.getHttpServer());
    const response = await agent
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    return { agent, sessionId: sessionIdFrom(response.headers['set-cookie']) };
  }

  it('未登录调用心跳返回 401（code=2001）', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/heartbeat')
      .expect(401);
    expect(response.body.code).toBe(2001);
  });

  it('登录后会话 TTL 与配置一致', async () => {
    const { sessionId } = await login();
    const ttl = await redis.ttl(`${SESSION_KEY_PREFIX}${sessionId}`);
    expect(ttl).toBeGreaterThan(expectedTtl - 60);
    expect(ttl).toBeLessThanOrEqual(expectedTtl);
  });

  it('普通接口请求不延长会话 TTL', async () => {
    const { agent, sessionId } = await login();
    const key = `${SESSION_KEY_PREFIX}${sessionId}`;
    await redis.expire(key, 60);
    await sleep(1100);

    await agent.get('/api/v1/auth/me').expect(200);

    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThan(60);
  });

  it('心跳把会话续期到完整 TTL 并重发 Cookie', async () => {
    const { agent, sessionId } = await login();
    const key = `${SESSION_KEY_PREFIX}${sessionId}`;
    await redis.expire(key, 60);
    await sleep(1100);

    const response = await agent.post('/api/v1/auth/heartbeat').expect(200);
    expect(response.headers['set-cookie']).toBeDefined();

    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(expectedTtl - 60);
  });

  it('空闲超过 TTL 后会话失效，需重新登录', async () => {
    const { agent, sessionId } = await login();
    await redis.expire(`${SESSION_KEY_PREFIX}${sessionId}`, 1);
    await sleep(1200);

    const response = await agent.get('/api/v1/auth/me').expect(401);
    expect(response.body.code).toBe(2001);
  });
});
