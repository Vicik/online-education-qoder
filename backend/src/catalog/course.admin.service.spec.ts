import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseAdminService } from './course.admin.service';
import { CourseService } from './course.service';

// 管理端写操作上下文（模拟已登录管理员）
const CTX = { actorId: 9, ip: '127.0.0.1', requestId: 'req-1' };

// 构建被测服务及 Prisma/审计替身
function setup() {
  const prisma = {
    course: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    chapter: { count: jest.fn() },
    order: { findMany: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const courses = { getDetail: jest.fn() };
  const storage = {
    resolveUrl: jest.fn(async (value: string | null) =>
      value === null
        ? null
        : /^https?:/i.test(value)
          ? value
          : `https://signed/${value}`,
    ),
  };
  const service = new CourseAdminService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    courses as unknown as CourseService,
    storage as unknown as StorageService,
  );
  return { prisma, audit, courses, storage, service };
}

// 草稿课程行
const DRAFT = {
  id: 1,
  name: '草稿课',
  type: 'video',
  status: 'draft',
  isRecommended: false,
  version: 3,
  originalCents: 19900,
  saleCents: 9900,
  instructor: '王老师',
  coverUrl: '',
  intro: null,
  detailRich: null,
};

// 已发布课程行
const PUBLISHED = { ...DRAFT, status: 'published' };
// 已下架课程行
const UNPUBLISHED = { ...DRAFT, status: 'unpublished' };

describe('CourseAdminService.create', () => {
  it('名称超过 40 字符返回 1001，售价高于原价返回 1001', async () => {
    const { service } = setup();

    await expect(
      service.create({
        name: 'x'.repeat(41),
        type: 'video',
        originalCents: 1000,
        saleCents: 1000,
        instructor: '王老师',
        coverUrl: 'image/demo/cover.png',
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });

    await expect(
      service.create({
        name: '新课',
        type: 'video',
        originalCents: 1000,
        saleCents: 1001,
        instructor: '王老师',
        coverUrl: 'image/demo/cover.png',
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('create 落草稿态并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.create.mockResolvedValue({ id: 3, status: 'draft' });

    await expect(
      service.create(
        {
          name: '新课',
          type: 'video',
          originalCents: 19900,
          saleCents: 9900,
          instructor: '王老师',
          coverUrl: 'image/demo/cover.png',
        },
        CTX,
      ),
    ).resolves.toMatchObject({ status: 'draft' });

    expect(prisma.course.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '新课',
        type: 'video',
        originalCents: 19900,
        saleCents: 9900,
        status: 'draft',
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 9,
        action: 'course.create',
        targetType: 'course',
        targetId: 3,
        requestId: 'req-1',
      }),
    );
  });

  it('detailRich 富文本经 sanitizeRichHtml 净化后落库', async () => {
    const { prisma, service } = setup();
    prisma.course.create.mockImplementation(({ data }) =>
      Promise.resolve(data),
    );

    const created = await service.create({
      name: '新课',
      type: 'rich',
      originalCents: 1000,
      saleCents: 1000,
      instructor: '王老师',
      coverUrl: 'image/demo/cover.png',
      detailRich: '<p onclick="x()">a</p>',
    });

    expect(created.detailRich).toBe('<p>a</p>');
  });
});

describe('CourseAdminService.update（§3.3 状态矩阵）', () => {
  it('草稿可改名称/类型/价格，并按 version 条件更新后自增', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(DRAFT);
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findUniqueOrThrow.mockResolvedValue({
      ...DRAFT,
      name: '新名',
    });

    await expect(
      service.update(1, {
        version: 3,
        name: '新名',
        type: 'video',
        originalCents: 19900,
        saleCents: 8900,
        instructor: '李老师',
        coverUrl: 'https://cdn.example.com/a.png',
        intro: '新简介',
        detailRich: '<p>详情</p>',
      }),
    ).resolves.toBeDefined();

    expect(prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 3 },
      data: expect.objectContaining({
        name: '新名',
        type: 'video',
        originalCents: 19900,
        saleCents: 8900,
        instructor: '李老师',
        coverUrl: 'https://cdn.example.com/a.png',
        intro: '新简介',
        detailRich: '<p>详情</p>',
        version: { increment: 1 },
      }),
    });
  });

  it('首个章节保存后草稿不可改类型', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(DRAFT);
    prisma.chapter.count.mockResolvedValue(1);

    await expect(
      service.update(1, { version: 3, type: 'audio' }),
    ).rejects.toMatchObject({
      bizCode: 1001,
      message: expect.stringContaining('类型'),
    });
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
  });

  it('已发布不可改名称/价格/讲师等任何基本信息，提示先下架', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED);

    const fields = [
      { name: '新名' },
      { type: 'audio' as const },
      { originalCents: 1 },
      { saleCents: 1 },
      { instructor: '李老师' },
      { coverUrl: 'https://cdn.example.com/b.png' },
      { intro: '新简介' },
      { detailRich: '<p>x</p>' },
    ];
    for (const field of fields) {
      await expect(
        service.update(1, { version: 3, ...field }),
      ).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining('下架'),
      });
    }
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
  });

  it('已下架仅可改讲师/封面/简介/详细介绍，不可改名称与价格', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(UNPUBLISHED);
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findUniqueOrThrow.mockResolvedValue(UNPUBLISHED);

    await expect(
      service.update(1, {
        version: 3,
        instructor: '李老师',
        coverUrl: 'https://cdn.example.com/c.png',
        intro: '新简介',
        detailRich: '<p>新详情</p>',
      }),
    ).resolves.toBeDefined();
    expect(prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 3 },
      data: expect.objectContaining({
        instructor: '李老师',
        coverUrl: 'https://cdn.example.com/c.png',
        intro: '新简介',
        detailRich: '<p>新详情</p>',
      }),
    });

    const lockedFields = [
      { name: '新名' },
      { type: 'audio' as const },
      { originalCents: 1 },
      { saleCents: 1 },
    ];
    for (const field of lockedFields) {
      await expect(
        service.update(1, { version: 3, ...field }),
      ).rejects.toMatchObject({ bizCode: 1001 });
    }
  });

  it('version 不匹配返回 409（code=4004）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ ...DRAFT, version: 5 });

    await expect(
      service.update(1, { version: 3, name: '新名' }),
    ).rejects.toMatchObject({
      bizCode: 4004,
      status: 409,
      message: expect.stringContaining('刷新'),
    });
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
  });

  it('条件更新计数为 0 视为版本冲突 409', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(DRAFT);
    prisma.course.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(1, { version: 3, name: '新名' }),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it('售价不得高于原价（含同次修改原价）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(DRAFT);

    await expect(
      service.update(1, { version: 3, saleCents: 20000 }),
    ).rejects.toMatchObject({ bizCode: 1001 });

    await expect(
      service.update(1, { version: 3, originalCents: 5000 }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('update 对 detailRich 净化，并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findUnique.mockResolvedValue(DRAFT);
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findUniqueOrThrow.mockResolvedValue(DRAFT);

    await service.update(
      1,
      { version: 3, detailRich: '<p onclick="x()">a</p>' },
      CTX,
    );

    expect(prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 3 },
      data: expect.objectContaining({ detailRich: '<p>a</p>' }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 9,
        action: 'course.update',
        targetType: 'course',
        targetId: 1,
      }),
    );
  });
});

describe('CourseAdminService.publish / unpublish', () => {
  it('publish 允许草稿与已下架，已发布被拒', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(DRAFT);
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findUniqueOrThrow.mockResolvedValue({
      ...DRAFT,
      status: 'published',
    });

    await expect(service.publish(1)).resolves.toBeDefined();

    prisma.course.findUnique.mockResolvedValue(UNPUBLISHED);
    await expect(service.publish(1)).resolves.toBeDefined();

    prisma.course.findUnique.mockResolvedValue(PUBLISHED);
    await expect(service.publish(1)).rejects.toMatchObject({ status: 422 });
  });

  it('publish 自增版本并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findUnique.mockResolvedValue(DRAFT);
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findUniqueOrThrow.mockResolvedValue({
      ...DRAFT,
      status: 'published',
    });

    await service.publish(1, CTX);

    expect(prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: { in: ['draft', 'unpublished'] } },
      data: { status: 'published', version: { increment: 1 } },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'course.publish', targetId: 1 }),
    );
  });

  it('unpublish 仅已发布可执行', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED);
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findUniqueOrThrow.mockResolvedValue(UNPUBLISHED);

    await expect(service.unpublish(1)).resolves.toBeDefined();

    prisma.course.findUnique.mockResolvedValue(DRAFT);
    await expect(service.unpublish(1)).rejects.toMatchObject({ status: 422 });
  });

  it('unpublish 条件更新失败视为冲突 409', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED);
    prisma.course.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.unpublish(1)).rejects.toMatchObject({ status: 409 });
  });
});

describe('CourseAdminService.recommend / unrecommend', () => {
  it('recommend 标记推荐位并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ ...PUBLISHED, isRecommended: false });
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findUniqueOrThrow.mockResolvedValue({
      ...PUBLISHED,
      isRecommended: true,
    });

    await expect(service.recommend(1, CTX)).resolves.toMatchObject({
      isRecommended: true,
    });

    expect(prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: 1, isRecommended: false },
      data: { isRecommended: true },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'course.recommend', targetId: 1 }),
    );
  });

  it('recommend 已推荐返回 422，课程不存在返回 404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ ...PUBLISHED, isRecommended: true });
    await expect(service.recommend(1)).rejects.toMatchObject({ status: 422 });

    prisma.course.findUnique.mockResolvedValue(null);
    await expect(service.recommend(99)).rejects.toMatchObject({ status: 404 });
  });

  it('unrecommend 取消推荐并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ ...PUBLISHED, isRecommended: true });
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findUniqueOrThrow.mockResolvedValue({
      ...PUBLISHED,
      isRecommended: false,
    });

    await expect(service.unrecommend(1, CTX)).resolves.toMatchObject({
      isRecommended: false,
    });

    expect(prisma.course.updateMany).toHaveBeenCalledWith({
      where: { id: 1, isRecommended: true },
      data: { isRecommended: false },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'course.unrecommend', targetId: 1 }),
    );
  });

  it('unrecommend 未推荐返回 422，条件更新失败视为冲突 409', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ ...PUBLISHED, isRecommended: false });
    await expect(service.unrecommend(1)).rejects.toMatchObject({ status: 422 });

    prisma.course.findUnique.mockResolvedValue({ ...PUBLISHED, isRecommended: true });
    prisma.course.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.unrecommend(1)).rejects.toMatchObject({ status: 409 });
  });

  it('recommend / unrecommend 仅已发布课程可执行', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ ...DRAFT, isRecommended: false });
    await expect(service.recommend(1)).rejects.toMatchObject({ status: 422 });
    expect(prisma.course.updateMany).not.toHaveBeenCalled();

    prisma.course.findUnique.mockResolvedValue({ ...DRAFT, isRecommended: true });
    await expect(service.unrecommend(1)).rejects.toMatchObject({ status: 422 });
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
  });
});

describe('CourseAdminService.listAll / getDetail', () => {
  it('listAll 含全部状态与报名人数/章节数，并支持状态筛选', async () => {
    const { prisma, service } = setup();
    prisma.course.findMany.mockResolvedValue([
      {
        ...DRAFT,
        coverUrl: 'zhixu/2026/11/cover.png',
        isRecommended: true,
        _count: { chapters: 2 },
      },
    ]);
    prisma.course.count.mockResolvedValue(1);
    prisma.order.findMany.mockResolvedValue([
      { courseId: 1, userId: 10 },
      { courseId: 1, userId: 11 },
    ]);

    const result = await service.listAll({ page: 1, pageSize: 20 }, 'draft');

    expect(result).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [
        {
          id: 1,
          coverKey: 'zhixu/2026/11/cover.png',
          coverUrl: 'https://signed/zhixu/2026/11/cover.png',
          isRecommended: true,
          chapterCount: 2,
          enrollmentCount: 2,
        },
      ],
    });
    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'draft' },
        select: expect.objectContaining({
          isRecommended: true,
          _count: { select: { chapters: true } },
        }),
      }),
    );
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: { in: [1] }, status: 'paid' },
        distinct: ['courseId', 'userId'],
      }),
    );
  });

  it('getDetail 以管理端视角获取含草稿/下架的详情', async () => {
    const { courses, service } = setup();
    courses.getDetail.mockResolvedValue({ id: 1, status: 'draft' });

    await expect(service.getDetail(1)).resolves.toMatchObject({
      status: 'draft',
    });
    expect(courses.getDetail).toHaveBeenCalledWith(1, true);
  });
});
