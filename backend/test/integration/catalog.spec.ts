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
  DEMO_GROUPON_USER,
  DEMO_USER,
  GROUPON_ACTIVITY,
} from '../../prisma/seed-data';

// 一天毫秒数：用于构造已结束/未开始的活动时间窗
const DAY_MS = 24 * 60 * 60 * 1000;

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

  it('游客列表只返回已发布且无有效拼团/秒杀的课程', async () => {
    // 普通课程：无任何活动，应出现在列表
    const normal = await prisma.course.create({
      data: {
        name: '集成测试普通课程',
        type: 'audio',
        originalCents: 100,
        saleCents: 100,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'published',
      },
    });
    // 活动已结束的课程：不应再从普通列表排除
    const ended = await prisma.course.create({
      data: {
        name: '集成测试已结束拼团课程',
        type: 'audio',
        originalCents: 100,
        saleCents: 100,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'published',
      },
    });
    await prisma.grouponActivity.create({
      data: {
        courseId: ended.id,
        name: '已结束拼团',
        priceCents: 100,
        targetSize: 2,
        startAt: new Date(Date.now() - 2 * DAY_MS),
        endAt: new Date(Date.now() - DAY_MS),
        status: 'ended',
      },
    });
    // 秒杀未开始的课程：属于当前有效活动，应被排除
    const upcoming = await prisma.course.create({
      data: {
        name: '集成测试未开始秒杀课程',
        type: 'audio',
        originalCents: 100,
        saleCents: 100,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'published',
      },
    });
    await prisma.flashSaleActivity.create({
      data: {
        courseId: upcoming.id,
        name: '未开始秒杀',
        priceCents: 100,
        stock: 10,
        startAt: new Date(Date.now() + DAY_MS),
        endAt: new Date(Date.now() + 2 * DAY_MS),
        status: 'not_started',
      },
    });

    try {
      const res = await request(app.getHttpServer())
        .get('/api/v1/courses?pageSize=100')
        .expect(200);
      const names = res.body.data.items.map((c: { name: string }) => c.name);
      expect(names).toContain(normal.name);
      expect(names).toContain(ended.name);
      expect(names).not.toContain(upcoming.name);
      // 种子课程存在进行中拼团与未开始秒杀，不出现在普通课程列表
      expect(names).not.toContain(COURSE_TYPESCRIPT.name);
      expect(res.body.data).toMatchObject({ page: 1, pageSize: 100 });
    } finally {
      await prisma.flashSaleActivity.deleteMany({
        where: { courseId: { in: [ended.id, upcoming.id] } },
      });
      await prisma.grouponActivity.deleteMany({
        where: { courseId: { in: [ended.id, upcoming.id] } },
      });
      await prisma.course.deleteMany({
        where: { id: { in: [normal.id, ended.id, upcoming.id] } },
      });
    }
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
        type: 'audio',
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
        type: 'audio',
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
        type: 'audio',
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

  it('已购用户详情返回章节已学标记，访问后对应章节标记为已学', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: DEMO_USER.email, password: DEMO_USER.password })
      .expect(200);

    // 已购用户：详情章节带 visited 字段
    const before = await agent
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}`)
      .expect(200);
    expect(before.body.data.chapters).toHaveLength(2);
    before.body.data.chapters.forEach((chapter: { visited?: boolean }) => {
      expect(typeof chapter.visited).toBe('boolean');
    });

    // 上报本章访问后，详情对应章节 visited=true
    await agent
      .post(`/api/v1/learning/${COURSE_TYPESCRIPT.id}/chapters/1/visit`)
      .expect(200);
    const after = await agent
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}`)
      .expect(200);
    expect(
      after.body.data.chapters.find((chapter: { id: number }) => chapter.id === 1)
        .visited,
    ).toBe(true);

    // 清理本次访问记录，避免影响其他用例
    await prisma.learningRecord.deleteMany({
      where: {
        courseId: COURSE_TYPESCRIPT.id,
        chapterId: 1,
        user: { email: DEMO_USER.email },
      },
    });
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
