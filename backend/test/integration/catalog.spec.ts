import { INestApplication } from '@nestjs/common';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
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
  DEMO_GROUPON_USER,
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

  it('首页推荐仅返回管理员手动推荐且已发布的课程', async () => {
    // 未推荐课程
    const normal = await prisma.course.create({
      data: {
        name: '集成测试未推荐课程',
        type: 'rich',
        originalCents: 100,
        saleCents: 100,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'published',
        isRecommended: false,
      },
    });
    // 已推荐课程
    const recommended = await prisma.course.create({
      data: {
        name: '集成测试推荐课程',
        type: 'rich',
        originalCents: 100,
        saleCents: 100,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'published',
        isRecommended: true,
      },
    });
    try {
      const res = await request(app.getHttpServer())
        .get('/api/v1/home/recommendations')
        .expect(200);
      const names = res.body.data.courses.map((c: { name: string }) => c.name);
      expect(names).toContain(recommended.name);
      expect(names).not.toContain(normal.name);
      // 种子课程已发布但未推荐，不出现在推荐位
      expect(names).not.toContain(COURSE_TYPESCRIPT.name);
    } finally {
      await prisma.course.deleteMany({
        where: { id: { in: [normal.id, recommended.id] } },
      });
    }
  });

  it('下架课程不出现在列表/推荐，详情按不存在处理', async () => {
    const temp = await prisma.course.create({
      data: {
        name: '集成测试下架课程',
        type: 'rich',
        originalCents: 100,
        saleCents: 100,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'unpublished',
        // 即使标记推荐，下架课程也不进入推荐位
        isRecommended: true,
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

  it('游客访问章节正文 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}/chapters/1/content`)
      .expect(401);
  });

  it('种子学员持普通已支付订单，可读取章节正文', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: DEMO_USER.email, password: DEMO_USER.password })
      .expect(200);

    const res = await agent
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}/chapters/1/content`)
      .expect(200);
    expect(res.body.data.title).toBe(COURSE_TYPESCRIPT.chapters[0].title);
    // 种子章节不指向不存在的媒体文件，正文读取成功但内容为空
    expect(res.body.data.content).toBeNull();
  });

  it('拼团待成团用户不可学习（code=3002）', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({
        email: DEMO_GROUPON_USER.email,
        password: DEMO_GROUPON_USER.password,
      })
      .expect(200);

    // 独立拼团演示账号仅有待成团拼团订单，未成团不可学习
    const res = await agent
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}/chapters/1/content`)
      .expect(403);
    expect(res.body.code).toBe(3002);
  });
});
