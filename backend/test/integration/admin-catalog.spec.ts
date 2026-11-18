import { INestApplication } from '@nestjs/common';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import { DEMO_ADMIN, DEMO_USER } from '../../prisma/seed-data';

describe('课程管理端（CI 集成，基于种子）', () => {
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

  it('普通用户访问管理端 403（code=2002）', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: DEMO_USER.email, password: DEMO_USER.password })
      .expect(200);

    const res = await agent.get('/api/v1/admin/courses').expect(403);
    expect(res.body.code).toBe(2002);
  });

  it('管理员创建草稿 → 加章节锁定类型 → 发布 → 已发布不可改价', async () => {
    const agent = await adminAgent();

    const created = await agent
      .post('/api/v1/admin/courses')
      .send({
        name: '集成测试课',
        type: 'video',
        originalCents: 9900,
        saleCents: 4900,
        instructor: '王老师',
        coverUrl: 'image/2026/11/12/00000000-0000-0000-0000-000000000001.png',
      })
      .expect(201);
    const courseId = created.body.data.id;
    expect(created.body.data).toMatchObject({ status: 'draft' });

    // 草稿详情可查看
    await agent.get(`/api/v1/admin/courses/${courseId}`).expect(200);

    // 首个章节保存后类型锁定：改类型被拒
    await agent
      .post(`/api/v1/admin/courses/${courseId}/chapters`)
      .send({
        title: '第一节',
        contentType: 'video',
        content: 'video/2026/11/12/00000000-0000-0000-0000-000000000001.mp4',
      })
      .expect(201);
    await agent
      .put(`/api/v1/admin/courses/${courseId}`)
      .send({ version: created.body.data.version, type: 'audio' })
      .expect(422);

    // 发布后版本自增
    const published = await agent
      .post(`/api/v1/admin/courses/${courseId}/publish`)
      .expect(200);
    expect(published.body.data).toMatchObject({ status: 'published' });

    // 已发布禁止改价（状态矩阵）
    const put = await agent
      .put(`/api/v1/admin/courses/${courseId}`)
      .send({ version: published.body.data.version, saleCents: 1 })
      .expect(422);
    expect(put.body.message).toContain('下架');
  });

  it('乐观锁冲突 409（code=4004）', async () => {
    const agent = await adminAgent();

    const created = await agent
      .post('/api/v1/admin/courses')
      .send({
        name: '冲突课',
        type: 'audio',
        originalCents: 1000,
        saleCents: 1000,
        instructor: '王老师',
        coverUrl: 'image/2026/11/12/00000000-0000-0000-0000-000000000002.png',
      })
      .expect(201);
    const courseId = created.body.data.id;
    const version = created.body.data.version;

    await agent
      .put(`/api/v1/admin/courses/${courseId}`)
      .send({ version, intro: '第一次' })
      .expect(200);

    const conflict = await agent
      .put(`/api/v1/admin/courses/${courseId}`)
      .send({ version, intro: '旧版本覆盖' })
      .expect(409);
    expect(conflict.body.code).toBe(4004);
  });

  it('讲师与封面缺失或为空时创建/编辑返回 400（code=1001）', async () => {
    const agent = await adminAgent();
    const base = {
      name: '必填校验课',
      type: 'video',
      originalCents: 1000,
      saleCents: 900,
    };

    const noInstructor = await agent
      .post('/api/v1/admin/courses')
      .send({ ...base, coverUrl: 'image/2026/11/12/cover.png' })
      .expect(400);
    expect(noInstructor.body.code).toBe(1001);

    const noCover = await agent
      .post('/api/v1/admin/courses')
      .send({ ...base, instructor: '王老师' })
      .expect(400);
    expect(noCover.body.code).toBe(1001);

    const emptyInstructor = await agent
      .post('/api/v1/admin/courses')
      .send({
        ...base,
        instructor: '',
        coverUrl: 'image/2026/11/12/cover.png',
      })
      .expect(400);
    expect(emptyInstructor.body.code).toBe(1001);

    const emptyName = await agent
      .post('/api/v1/admin/courses')
      .send({
        ...base,
        name: '',
        instructor: '王老师',
        coverUrl: 'image/2026/11/12/cover.png',
      })
      .expect(400);
    expect(emptyName.body.code).toBe(1001);

    const created = await agent
      .post('/api/v1/admin/courses')
      .send({
        ...base,
        instructor: '王老师',
        coverUrl: 'image/2026/11/12/cover.png',
      })
      .expect(201);

    const emptyTitle = await agent
      .post(`/api/v1/admin/courses/${created.body.data.id}/chapters`)
      .send({ title: '', contentType: 'video' })
      .expect(400);
    expect(emptyTitle.body.code).toBe(1001);

    // 正文必填：新增不传/传空、编辑传 null 均 400
    const noContent = await agent
      .post(`/api/v1/admin/courses/${created.body.data.id}/chapters`)
      .send({ title: '缺正文', contentType: 'video' })
      .expect(400);
    expect(noContent.body.code).toBe(1001);

    const emptyContent = await agent
      .post(`/api/v1/admin/courses/${created.body.data.id}/chapters`)
      .send({ title: '空正文', contentType: 'video', content: '' })
      .expect(400);
    expect(emptyContent.body.code).toBe(1001);

    const chapter = await agent
      .post(`/api/v1/admin/courses/${created.body.data.id}/chapters`)
      .send({
        title: '有正文',
        contentType: 'video',
        content: 'video/2026/11/12/required.mp4',
      })
      .expect(201);

    const nullContent = await agent
      .put(
        `/api/v1/admin/courses/${created.body.data.id}/chapters/${chapter.body.data.id}`,
      )
      .send({ content: null })
      .expect(400);
    expect(nullContent.body.code).toBe(1001);

    const emptyOnUpdate = await agent
      .put(`/api/v1/admin/courses/${created.body.data.id}`)
      .send({ version: created.body.data.version, coverUrl: '' })
      .expect(400);
    expect(emptyOnUpdate.body.code).toBe(1001);

    const blankName = await agent
      .post('/api/v1/admin/courses')
      .send({
        ...base,
        name: '   ',
        instructor: '王老师',
        coverUrl: 'image/2026/11/12/cover.png',
      })
      .expect(400);
    expect(blankName.body.code).toBe(1001);

    const emptyOrder = await agent
      .post(`/api/v1/admin/courses/${created.body.data.id}/chapters/reorder`)
      .send({ orderedChapterIds: [] })
      .expect(400);
    expect(emptyOrder.body.code).toBe(1001);
  });

  it('推荐/取消推荐：进入首页推荐，重复操作 422', async () => {
    const agent = await adminAgent();

    const created = await agent
      .post('/api/v1/admin/courses')
      .send({
        name: '集成测试推荐课',
        type: 'audio',
        originalCents: 1000,
        saleCents: 900,
        instructor: '王老师',
        coverUrl: 'image/2026/11/12/00000000-0000-0000-0000-000000000003.png',
      })
      .expect(201);
    const courseId = created.body.data.id;
    // 草稿不可推荐/取消推荐
    await agent.post(`/api/v1/admin/courses/${courseId}/recommend`).expect(422);
    await agent
      .post(`/api/v1/admin/courses/${courseId}/unrecommend`)
      .expect(422);
    // 无章节不可发布
    const noChapter = await agent
      .post(`/api/v1/admin/courses/${courseId}/publish`)
      .expect(422);
    expect(noChapter.body.message).toContain('至少需要 1 个章节');
    // 补一个章节后可发布，发布后才会进入首页推荐
    await agent
      .post(`/api/v1/admin/courses/${courseId}/chapters`)
      .send({
        title: '推荐课第一节',
        contentType: 'audio',
        content: 'audio/2026/11/12/00000000-0000-0000-0000-000000000003.mp3',
      })
      .expect(201);
    await agent.post(`/api/v1/admin/courses/${courseId}/publish`).expect(200);

    try {
      const recommended = await agent
        .post(`/api/v1/admin/courses/${courseId}/recommend`)
        .expect(200);
      expect(recommended.body.data).toMatchObject({ isRecommended: true });

      // 管理端列表带回推荐标记
      const list = await agent
        .get('/api/v1/admin/courses?pageSize=100')
        .expect(200);
      const item = list.body.data.items.find(
        (row: { id: number }) => row.id === courseId,
      );
      expect(item).toMatchObject({ isRecommended: true });

      // 已推荐后再推荐 422
      await agent
        .post(`/api/v1/admin/courses/${courseId}/recommend`)
        .expect(422);

      // 首页推荐包含该课程
      const homeAfterRecommend = await request(app.getHttpServer())
        .get('/api/v1/home/recommendations')
        .expect(200);
      expect(
        homeAfterRecommend.body.data.courses.map((c: { id: number }) => c.id),
      ).toContain(courseId);

      const unrecommended = await agent
        .post(`/api/v1/admin/courses/${courseId}/unrecommend`)
        .expect(200);
      expect(unrecommended.body.data).toMatchObject({ isRecommended: false });

      // 未推荐后再取消 422
      await agent
        .post(`/api/v1/admin/courses/${courseId}/unrecommend`)
        .expect(422);

      const homeAfterUnrecommend = await request(app.getHttpServer())
        .get('/api/v1/home/recommendations')
        .expect(200);
      expect(
        homeAfterUnrecommend.body.data.courses.map((c: { id: number }) => c.id),
      ).not.toContain(courseId);
    } finally {
      await prisma.course.deleteMany({ where: { id: courseId } });
    }
  });

  it('宣传位：设为宣传进入首页 banner，可手动排序，下架清标记', async () => {
    const agent = await adminAgent();
    // 起始清空宣传位，避免受其他用例影响
    await prisma.course.updateMany({
      where: { isPromoted: true },
      data: { isPromoted: false, promotionOrder: 0 },
    });

    const createdIds: number[] = [];

    // 创建并发布一门音频课，返回课程 id
    async function createPublished(name: string): Promise<number> {
      const created = await agent
        .post('/api/v1/admin/courses')
        .send({
          name,
          type: 'audio',
          originalCents: 1000,
          saleCents: 900,
          instructor: '王老师',
          coverUrl: 'image/2026-11-12/00000000-0000-0000-0000-000000000003.png',
        })
        .expect(201);
      const courseId = created.body.data.id as number;
      createdIds.push(courseId);
      await agent
        .post(`/api/v1/admin/courses/${courseId}/chapters`)
        .send({
          title: '第一节',
          contentType: 'audio',
          content: 'audio/2026-11-12/00000000-0000-0000-0000-000000000003.mp3',
        })
        .expect(201);
      await agent.post(`/api/v1/admin/courses/${courseId}/publish`).expect(200);
      return courseId;
    }

    // 首页 banner 当前课程 id 顺序
    async function bannerIds(): Promise<number[]> {
      const banners = await request(app.getHttpServer())
        .get('/api/v1/home/banners')
        .expect(200);
      return banners.body.data.courses.map((row: { id: number }) => row.id);
    }

    const first = await createPublished('集成测试宣传课一');
    const second = await createPublished('集成测试宣传课二');

    try {
      // 草稿不可宣传
      const draft = await agent
        .post('/api/v1/admin/courses')
        .send({
          name: '集成测试宣传草稿',
          type: 'audio',
          originalCents: 1000,
          saleCents: 900,
          instructor: '王老师',
          coverUrl: 'image/2026-11-12/00000000-0000-0000-0000-000000000003.png',
        })
        .expect(201);
      createdIds.push(draft.body.data.id);
      await agent
        .post(`/api/v1/admin/courses/${draft.body.data.id}/promote`)
        .expect(422);

      // 设为宣传：序号从 1 开始追加
      const promotedFirst = await agent
        .post(`/api/v1/admin/courses/${first}/promote`)
        .expect(200);
      expect(promotedFirst.body.data).toMatchObject({
        isPromoted: true,
        promotionOrder: 1,
      });
      // 重复宣传 422
      await agent.post(`/api/v1/admin/courses/${first}/promote`).expect(422);

      const promotedSecond = await agent
        .post(`/api/v1/admin/courses/${second}/promote`)
        .expect(200);
      expect(promotedSecond.body.data).toMatchObject({ promotionOrder: 2 });

      // 管理端列表带回宣传标记
      const list = await agent
        .get('/api/v1/admin/courses?pageSize=100')
        .expect(200);
      const firstItem = list.body.data.items.find(
        (row: { id: number }) => row.id === first,
      );
      expect(firstItem).toMatchObject({ isPromoted: true, promotionOrder: 1 });

      // banner 顺序与设置顺序一致
      expect(await bannerIds()).toEqual([first, second]);

      // 管理端宣传位列表与 banner 同源
      const promotionList = await agent
        .get('/api/v1/admin/courses/promotion')
        .expect(200);
      expect(
        promotionList.body.data.map((row: { id: number }) => row.id),
      ).toEqual([first, second]);

      // 非法排序：与当前宣传集合不一致
      await agent
        .post('/api/v1/admin/courses/promotion/reorder')
        .send({ courseIds: [first] })
        .expect(422);
      // 非法排序：空数组按参数错误
      await agent
        .post('/api/v1/admin/courses/promotion/reorder')
        .send({ courseIds: [] })
        .expect(400);

      // 手动排序：第二门排到最前
      const reordered = await agent
        .post('/api/v1/admin/courses/promotion/reorder')
        .send({ courseIds: [second, first] })
        .expect(200);
      expect(reordered.body.data.map((row: { id: number }) => row.id)).toEqual([
        second,
        first,
      ]);
      expect(await bannerIds()).toEqual([second, first]);

      // 取消宣传：标记与序号一并清除
      const unpromoted = await agent
        .post(`/api/v1/admin/courses/${second}/unpromote`)
        .expect(200);
      expect(unpromoted.body.data).toMatchObject({
        isPromoted: false,
        promotionOrder: 0,
      });
      // 未宣传时取消 422
      await agent
        .post(`/api/v1/admin/courses/${second}/unpromote`)
        .expect(422);
      expect(await bannerIds()).toEqual([first]);

      // 下架：宣传与推荐标记同时清除，banner 不再返回
      await agent.post(`/api/v1/admin/courses/${first}/recommend`).expect(200);
      await agent.post(`/api/v1/admin/courses/${first}/unpublish`).expect(200);
      const unpublished = await prisma.course.findUniqueOrThrow({
        where: { id: first },
      });
      expect(unpublished).toMatchObject({
        status: 'unpublished',
        isPromoted: false,
        promotionOrder: 0,
        isRecommended: false,
      });
      expect(await bannerIds()).toEqual([]);
    } finally {
      await prisma.course.updateMany({
        where: { isPromoted: true },
        data: { isPromoted: false, promotionOrder: 0 },
      });
      await prisma.course.deleteMany({ where: { id: { in: createdIds } } });
    }
  });

  it('宣传位上限 5：第 6 门设为宣传返回 422', async () => {
    const agent = await adminAgent();
    await prisma.course.updateMany({
      where: { isPromoted: true },
      data: { isPromoted: false, promotionOrder: 0 },
    });

    // 本用例创建的课程 id
    const createdIds: number[] = [];

    try {
      // 依次创建并发布 6 门课程，前 5 门宣传成功，第 6 门被上限拒绝
      for (let index = 1; index <= 6; index += 1) {
        const created = await agent
          .post('/api/v1/admin/courses')
          .send({
            name: `宣传上限课${index}`,
            type: 'audio',
            originalCents: 1000,
            saleCents: 900,
            instructor: '王老师',
            coverUrl: 'image/2026-11-12/00000000-0000-0000-0000-000000000003.png',
          })
          .expect(201);
        const courseId = created.body.data.id as number;
        createdIds.push(courseId);
        await agent
          .post(`/api/v1/admin/courses/${courseId}/chapters`)
          .send({
            title: '第一节',
            contentType: 'audio',
            content: 'audio/2026-11-12/00000000-0000-0000-0000-000000000003.mp3',
          })
          .expect(201);
        await agent
          .post(`/api/v1/admin/courses/${courseId}/publish`)
          .expect(200);

        if (index <= 5) {
          await agent
            .post(`/api/v1/admin/courses/${courseId}/promote`)
            .expect(200);
        } else {
          const limited = await agent
            .post(`/api/v1/admin/courses/${courseId}/promote`)
            .expect(422);
          expect(limited.body.message).toContain('最多 5');
        }
      }

      // banner 最多返回 5 门
      const banners = await request(app.getHttpServer())
        .get('/api/v1/home/banners')
        .expect(200);
      expect(banners.body.data.courses).toHaveLength(5);
    } finally {
      await prisma.course.updateMany({
        where: { isPromoted: true },
        data: { isPromoted: false, promotionOrder: 0 },
      });
      await prisma.course.deleteMany({ where: { id: { in: createdIds } } });
    }
  });

  it('每次管理端写操作产生审计记录', async () => {
    const count = await prisma.auditLog.count({
      where: { action: { startsWith: 'course.' } },
    });
    expect(count).toBeGreaterThan(0);

    // 审计包含操作人（管理员）
    const latest = await prisma.auditLog.findFirst({
      where: { action: 'course.create' },
      orderBy: { createdAt: 'desc' },
    });
    expect(latest?.actorId).toEqual(expect.any(Number));
  });
});
