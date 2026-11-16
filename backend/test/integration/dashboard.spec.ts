import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
import { RedisService } from '../../src/redis/redis.service';
import { DEMO_ADMIN } from '../../prisma/seed-data';

describe('工作台统计（CI 集成，基于种子）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    const config = loadConfig();
    const redis = app.get(RedisService);
    // 与 main.ts 一致：路由注册前挂载会话中间件
    app.use(sessionMiddleware(config, () => redis.getClient()));
    app.useGlobalPipes(
      new TrimmingValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // 管理员登录，返回保持会话的 agent
  const adminAgent = async () => {
    // 保持 Cookie 的请求代理
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: DEMO_ADMIN.email, password: DEMO_ADMIN.password })
      .expect(200);
    return agent;
  };

  it('管理员获取八项统计且均为非负整数', async () => {
    const agent = await adminAgent();

    const res = await agent.get('/api/v1/admin/dashboard/stats').expect(200);
    // 统计字段：与 openapi DashboardStats 一致
    const stats = res.body.data;
    expect(Object.keys(stats).sort()).toEqual(
      [
        'courseCount',
        'ongoingFlashSaleCount',
        'ongoingGrouponCount',
        'orderCount',
        'paidOrderCount',
        'publishedCourseCount',
        'revenueCents',
        'userCount',
      ].sort(),
    );
    for (const value of Object.values(stats)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value as number).toBeGreaterThanOrEqual(0);
    }

    // 与数据库直接计数一致（用户仅普通角色、课程已发布数）
    expect(stats.userCount).toBe(
      await prisma.user.count({ where: { role: 'user' } }),
    );
    expect(stats.publishedCourseCount).toBe(
      await prisma.course.count({ where: { status: 'published' } }),
    );
    expect(stats.paidOrderCount).toBe(
      await prisma.order.count({ where: { status: 'paid' } }),
    );
  });

  it('普通用户访问 403（code=2002）', async () => {
    // 唯一邮箱：避免演示账号数据漂移影响
    const email = `dashboard-${Date.now()}@test.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'abc12345',
        confirmPassword: 'abc12345',
        nickname: '工作台测试',
      })
      .expect(201);

    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'abc12345' })
      .expect(200);

    const res = await agent.get('/api/v1/admin/dashboard/stats').expect(403);
    expect(res.body.code).toBe(2002);
  });
});
