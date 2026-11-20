import { INestApplication } from '@nestjs/common';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import { COURSE_TYPESCRIPT } from '../../prisma/seed-data';

// 每次运行唯一的学员邮箱，避免注册冲突
const TEST_EMAIL = `learning-${Date.now()}@test.com`;
// 测试账号密码（满足 8–64 位策略）
const TEST_PASSWORD = 'Passw0rd1';

describe('学习与收藏（CI 集成）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let agent: ReturnType<typeof request.agent>;

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

    // 注册并登录一个全新学员（无订单、无学习记录）
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        confirmPassword: TEST_PASSWORD,
        nickname: '学习测试',
      })
      .expect(201);

    agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('未登录访问学习记录返回 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/user/study-records').expect(401);
  });

  it('学习记录初始为空分页', async () => {
    const res = await agent.get('/api/v1/user/study-records').expect(200);
    expect(res.body.data).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it('未购访问 /learning 付费章节 403（code=3002）', async () => {
    const res = await agent
      .post(`/api/v1/learning/${COURSE_TYPESCRIPT.id}/chapters/2/visit`)
      .expect(403);
    expect(res.body.code).toBe(3002);
  });

  it('收藏缺少 Idempotency-Key 返回 400', async () => {
    const res = await agent
      .post('/api/v1/favorites')
      .send({ courseId: COURSE_TYPESCRIPT.id })
      .expect(400);
    expect(res.body.code).toBe(1001);
  });

  it('收藏不存在的课程返回 404（code=3001）', async () => {
    const res = await agent
      .post('/api/v1/favorites')
      .set('Idempotency-Key', 'learning-fav-missing-1')
      .send({ courseId: 999999 })
      .expect(404);
    expect(res.body.code).toBe(3001);
  });

  it('收藏幂等且列表形状正确', async () => {
    const body = { courseId: COURSE_TYPESCRIPT.id };
    // 同一幂等键重放、不同幂等键重复收藏，均不报错
    await agent
      .post('/api/v1/favorites')
      .set('Idempotency-Key', 'learning-fav-key-0001')
      .send(body)
      .expect(201);
    await agent
      .post('/api/v1/favorites')
      .set('Idempotency-Key', 'learning-fav-key-0001')
      .send(body)
      .expect(201);
    await agent
      .post('/api/v1/favorites')
      .set('Idempotency-Key', 'learning-fav-key-0002')
      .send(body)
      .expect(201);

    const list = await agent.get('/api/v1/user/favorites').expect(200);
    expect(list.body.data.total).toBe(1);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({
      id: COURSE_TYPESCRIPT.id,
      name: COURSE_TYPESCRIPT.name,
      type: COURSE_TYPESCRIPT.type,
      saleCents: COURSE_TYPESCRIPT.saleCents,
      status: 'published',
    });
  });

  it('取消收藏幂等，重复取消不报错', async () => {
    await agent
      .delete(`/api/v1/favorites/${COURSE_TYPESCRIPT.id}`)
      .expect(200);
    await agent
      .delete(`/api/v1/favorites/${COURSE_TYPESCRIPT.id}`)
      .expect(200);

    const list = await agent.get('/api/v1/user/favorites').expect(200);
    expect(list.body.data).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  it('已购未观看课程进入学习记录（0%）', async () => {
    // 原价下单并支付，不产生任何观看记录
    const created = await agent
      .post('/api/v1/orders')
      .set('Idempotency-Key', 'learning-order-0001')
      .send({ courseId: COURSE_TYPESCRIPT.id })
      .expect(201);
    const paid = await agent
      .post(`/api/v1/orders/${created.body.data.id}/pay`)
      .expect(200);

    const res = await agent.get('/api/v1/user/study-records').expect(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]).toMatchObject({
      courseId: COURSE_TYPESCRIPT.id,
      courseName: COURSE_TYPESCRIPT.name,
      visitedCount: 0,
      lastChapterId: null,
      lastChapterTitle: null,
      progressPercent: 0,
      completed: false,
      lastVisitedAt: paid.body.data.paidAt,
    });
  });

  it('未购登录用户可上报试看章节并进入学习记录', async () => {
    const email = `learning-trial-${Date.now()}@test.com`;
    // 直接创建登录用户，避免走注册限流等旁路依赖
    const user = await prisma.user.create({
      data: {
        email,
        nickname: '试看学员',
        passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      },
    });
    try {
      const trial = request.agent(app.getHttpServer());
      await trial
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);

      // 未购用户访问免费试看章节：允许并正常记录进度
      const visit = await trial
        .post(`/api/v1/learning/${COURSE_TYPESCRIPT.id}/chapters/1/visit`)
        .expect(200);
      expect(visit.body.data).toEqual({
        progressPercent: 50,
        completed: false,
      });

      // 试看记录进入学习记录列表
      const records = await trial
        .get('/api/v1/user/study-records')
        .expect(200);
      expect(records.body.data.items[0]).toMatchObject({
        courseId: COURSE_TYPESCRIPT.id,
        visitedCount: 1,
        lastChapterId: 1,
        lastChapterTitle: COURSE_TYPESCRIPT.chapters[0].title,
        progressPercent: 50,
        completed: false,
      });
    } finally {
      await prisma.learningRecord.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
