import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import {
  COUPON_TEMPLATE,
  COURSE_TYPESCRIPT,
  COURSE_WRITING,
  DEMO_USER,
  GROUPON_ACTIVITY,
} from '../../prisma/seed-data';

describe('课程浏览（CI 集成，基于种子）', () => {
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
      new ValidationPipe({
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

  it('游客列表只见已发布课程（含 course-typescript，不含 course-writing）', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/courses')
      .expect(200);
    const names = res.body.data.items.map((c: { name: string }) => c.name);
    expect(names).toContain(COURSE_TYPESCRIPT.name);
    expect(names).not.toContain(COURSE_WRITING.name);
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 20 });
  });

  it('详情包含章节目录（仅名称）与进行中拼团活动', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}`)
      .expect(200);
    const detail = res.body.data;
    expect(detail.chapters).toHaveLength(2);
    expect(detail.chapters[0]).not.toHaveProperty('content');
    expect(detail.groupon).toMatchObject({
      id: GROUPON_ACTIVITY.id,
      name: GROUPON_ACTIVITY.name,
      status: 'ongoing',
    });
    // 未开始的秒杀活动不出现在详情
    expect(detail.flashSale).toBeNull();
    // 可领券：启用且有效期内的模板
    expect(detail.claimableCoupons.map((c: { id: number }) => c.id)).toContain(
      COUPON_TEMPLATE.id,
    );
  });

  it('首页推荐只返回已发布课程', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/home/recommendations')
      .expect(200);
    const names = res.body.data.courses.map((c: { name: string }) => c.name);
    expect(names).toContain(COURSE_TYPESCRIPT.name);
    expect(names).not.toContain(COURSE_WRITING.name);
  });

  it('下架课程不出现在列表/推荐，详情按不存在处理', async () => {
    const temp = await prisma.course.create({
      data: {
        name: '集成测试下架课程',
        type: 'rich',
        originalCents: 100,
        saleCents: 100,
        status: 'unpublished',
      },
    });
    try {
      const list = await request(app.getHttpServer())
        .get('/api/v1/courses?pageSize=100')
        .expect(200);
      expect(
        list.body.data.items.map((c: { name: string }) => c.name),
      ).not.toContain(temp.name);

      const rec = await request(app.getHttpServer())
        .get('/api/v1/home/recommendations')
        .expect(200);
      expect(
        rec.body.data.courses.map((c: { name: string }) => c.name),
      ).not.toContain(temp.name);

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/courses/${temp.id}`)
        .expect(404);
      expect(detail.body.code).toBe(3001);
    } finally {
      await prisma.course.delete({ where: { id: temp.id } });
    }
  });

  it('游客访问章节正文 401；登录未购 403（code=3002）', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}/chapters/1/content`)
      .expect(401);

    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: DEMO_USER.email, password: DEMO_USER.password })
      .expect(200);

    // 种子用户仅有待成团拼团订单，未成团不可学习
    const res = await agent
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}/chapters/1/content`)
      .expect(403);
    expect(res.body.code).toBe(3002);
  });
});
