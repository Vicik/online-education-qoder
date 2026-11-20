import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseService } from './course.service';

// 构建被测服务及 Prisma 替身；存储替身模拟「key 签名、http 原样、空值 null」
function setup() {
  const prisma = {
    order: { findFirst: jest.fn() },
    course: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    chapter: { findMany: jest.fn(), findFirst: jest.fn() },
    grouponActivity: { findFirst: jest.fn() },
    flashSaleActivity: { findFirst: jest.fn() },
    couponTemplate: { findMany: jest.fn() },
    learningRecord: { findMany: jest.fn() },
  };
  const storage = {
    resolveUrl: jest.fn(async (value: string | null) =>
      value === null
        ? null
        : /^https?:/i.test(value)
          ? value
          : `https://signed/${value}`,
    ),
    resolveRichHtml: jest.fn(async (html: string) =>
      html.replace(/src="(zhixu\/[^"]+)"/g, 'src="https://signed/$1"'),
    ),
  };
  const service = new CourseService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
  );
  return { prisma, storage, service };
}

// 课程列表/详情测试共用的课程行数据（coverUrl 存对象存储 key）
const courseRow = {
  id: 1,
  name: 'TypeScript 系统入门',
  type: 'video',
  coverUrl: 'zhixu/2026/11/cover.png',
  instructor: '张老师',
  originalCents: 19900,
  saleCents: 9900,
  status: 'published',
};

// 期望的课程简要信息：coverKey 保留原 key，coverUrl 换签名地址
const courseBrief = {
  ...courseRow,
  coverKey: courseRow.coverUrl,
  coverUrl: 'https://signed/zhixu/2026/11/cover.png',
};

describe('CourseService.hasPaidAccess', () => {
  it('普通订单 paid 即有权限', async () => {
    const { prisma, service } = setup();
    prisma.order.findFirst.mockResolvedValue({ id: 1 });

    await expect(service.hasPaidAccess(1, 1)).resolves.toBe(true);

    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 1,
        courseId: 1,
        status: 'paid',
        OR: [
          { activityType: { not: 'groupon' } },
          { grouponMembers: { some: { group: { status: 'success' } } } },
        ],
      }),
    });
  });

  it('拼团订单需团组成团才有权限', async () => {
    const { prisma, service } = setup();
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(service.hasPaidAccess(1, 1)).resolves.toBe(false);
  });

  it('pending 订单无权限', async () => {
    const { prisma, service } = setup();
    prisma.order.findFirst.mockResolvedValue(null);

    expect(await service.hasPaidAccess(1, 1)).toBe(false);
  });
});

describe('CourseService.listPublished', () => {
  it('listPublished 只查已发布且无有效拼团/秒杀的课程并分页', async () => {
    const { prisma, service } = setup();
    prisma.course.findMany.mockResolvedValue([courseRow]);
    prisma.course.count.mockResolvedValue(1);

    await expect(
      service.listPublished({ page: 1, pageSize: 20 }),
    ).resolves.toEqual({
      items: [courseBrief],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'published',
          grouponActivities: {
            none: { status: { in: ['not_started', 'ongoing'] } },
          },
          flashSaleActivities: {
            none: { status: { in: ['not_started', 'ongoing'] } },
          },
        },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});

describe('CourseService.getDetail', () => {
  it('getDetail 拼装活动信息、可领券、章节目录（不含正文）', async () => {
    const { prisma, service } = setup();
    const startAt = new Date('2026-11-01T00:00:00Z');
    const endAt = new Date('2026-12-01T00:00:00Z');
    prisma.course.findFirst.mockResolvedValue({
      ...courseRow,
      version: 3,
      intro: '课程简介',
      detailRich:
        '<p>详情</p><img data-key="zhixu/2026/11/detail.png" src="zhixu/2026/11/detail.png" />',
    });
    prisma.chapter.findMany.mockResolvedValue([
      { id: 1, title: '第一章', contentType: 'video', sortOrder: 1, isFree: false },
    ]);
    prisma.grouponActivity.findFirst.mockResolvedValue({
      id: 1,
      courseId: 1,
      name: '双人团',
      priceCents: 6900,
      targetSize: 2,
      startAt,
      endAt,
      status: 'ongoing',
    });
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.couponTemplate.findMany.mockResolvedValue([
      {
        id: 1,
        name: '新学员立减券',
        discountCents: 2000,
        startAt,
        endAt,
        totalQty: 100,
        claimedCount: 0,
        status: 'enabled',
        courses: [{ courseId: 1 }],
      },
    ]);

    const detail = await service.getDetail(1);

    expect(detail.coverKey).toBe('zhixu/2026/11/cover.png');
    expect(detail.coverUrl).toBe('https://signed/zhixu/2026/11/cover.png');
    expect(detail.version).toBe(3);
    expect(detail.detailRich).toContain(
      '<p>详情</p><img data-key="zhixu/2026/11/detail.png" src="https://signed/zhixu/2026/11/detail.png"',
    );
    expect(detail.chapters[0]).not.toHaveProperty('content');
    expect(detail.chapters[0]).toEqual({
      id: 1,
      title: '第一章',
      contentType: 'video',
      sortOrder: 1,
      isFree: false,
    });
    expect(detail.groupon).toMatchObject({
      name: '双人团',
      courseName: 'TypeScript 系统入门',
    });
    expect(detail.flashSale).toBeNull();
    expect(detail.claimableCoupons[0]).toMatchObject({
      id: 1,
      courseIds: [1],
    });
    expect(prisma.course.findFirst).toHaveBeenCalledWith({
      where: { id: 1, status: 'published' },
    });
    expect(prisma.chapter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: 1 },
        select: {
          id: true,
          title: true,
          contentType: true,
          sortOrder: true,
          isFree: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
    );
    expect(prisma.grouponActivity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          courseId: 1,
          status: 'ongoing',
          endAt: expect.objectContaining({ gt: expect.any(Date) }),
        }),
      }),
    );
  });

  it('管理端详情返回章节正文 key，用户端不返回', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue({ ...courseRow, detailRich: null });
    prisma.chapter.findMany.mockResolvedValue([
      {
        id: 1,
        title: '第一章',
        contentType: 'video',
        sortOrder: 1,
        isFree: false,
        content: 'video/2026/11/12/a.mp4',
      },
    ]);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.couponTemplate.findMany.mockResolvedValue([]);

    const detail = await service.getDetail(1, true);

    expect(prisma.chapter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          title: true,
          contentType: true,
          sortOrder: true,
          isFree: true,
          content: true,
        },
      }),
    );
    expect(detail.chapters[0]).toMatchObject({
      content: 'video/2026/11/12/a.mp4',
    });
  });

  it('getDetail 非已发布课程抛 3001/404（游客视角）', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue(null);

    await expect(service.getDetail(1)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });

  it('已购用户详情返回章节已学标记，游客不返回', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue({ ...courseRow, detailRich: null });
    prisma.chapter.findMany.mockResolvedValue([
      { id: 1, title: '第一章', contentType: 'video', sortOrder: 1, isFree: false },
      { id: 2, title: '第二章', contentType: 'video', sortOrder: 2, isFree: false },
    ]);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.couponTemplate.findMany.mockResolvedValue([]);
    prisma.learningRecord.findMany.mockResolvedValue([{ chapterId: 2 }]);
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    const detail = await service.getDetail(1, false, 9);

    expect(prisma.learningRecord.findMany).toHaveBeenCalledWith({
      where: { userId: 9, courseId: 1 },
      select: { chapterId: true },
    });
    expect(detail.chapters).toEqual([
      {
        id: 1,
        title: '第一章',
        contentType: 'video',
        sortOrder: 1,
        isFree: false,
        visited: false,
      },
      {
        id: 2,
        title: '第二章',
        contentType: 'video',
        sortOrder: 2,
        isFree: false,
        visited: true,
      },
    ]);

    // 游客视角不查询学习记录
    prisma.learningRecord.findMany.mockClear();
    const guestDetail = await service.getDetail(1);
    expect(prisma.learningRecord.findMany).not.toHaveBeenCalled();
    expect(guestDetail.chapters[0]).not.toHaveProperty('visited');
  });

  it('登录未购用户也返回已学标记', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue({ ...courseRow, detailRich: null });
    prisma.chapter.findMany.mockResolvedValue([
      { id: 1, title: '第一章', contentType: 'video', sortOrder: 1, isFree: false },
      { id: 2, title: '第二章', contentType: 'video', sortOrder: 2, isFree: true },
    ]);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.couponTemplate.findMany.mockResolvedValue([]);
    prisma.learningRecord.findMany.mockResolvedValue([{ chapterId: 2 }]);

    const detail = await service.getDetail(1, false, 9);

    expect(prisma.learningRecord.findMany).toHaveBeenCalledWith({
      where: { userId: 9, courseId: 1 },
      select: { chapterId: true },
    });
    expect(detail.chapters[1]).toMatchObject({ id: 2, visited: true, isFree: true });
  });

  it('免费课程不查询可领券并返回空数组', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue({
      ...courseRow,
      saleCents: 0,
      detailRich: null,
    });
    prisma.chapter.findMany.mockResolvedValue([
      { id: 1, title: '第一章', contentType: 'video', sortOrder: 1, isFree: false },
    ]);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);

    const detail = await service.getDetail(1);

    expect(prisma.couponTemplate.findMany).not.toHaveBeenCalled();
    expect(detail.claimableCoupons).toEqual([]);
  });
});

describe('CourseService.listRecommendations', () => {
  it('listRecommendations 仅取管理员推荐且已发布的最近 8 条', async () => {
    const { prisma, service } = setup();
    prisma.course.findMany.mockResolvedValue([courseRow]);

    await expect(service.listRecommendations()).resolves.toEqual([courseBrief]);
    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'published', isRecommended: true },
        take: 8,
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});

describe('CourseService.listBanners', () => {
  it('listBanners 仅取已发布的宣传课程，按宣传位顺序升序且最多 5 条', async () => {
    const { prisma, service } = setup();
    prisma.course.findMany.mockResolvedValue([courseRow]);

    await expect(service.listBanners()).resolves.toEqual([courseBrief]);
    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'published', isPromoted: true },
        take: 5,
        orderBy: { promotionOrder: 'asc' },
      }),
    );
  });
});

describe('CourseService.resolveChapterAccess', () => {
  const FREE_COURSE = { id: 1, status: 'published', saleCents: 0 };
  const PAID_COURSE = { id: 1, status: 'published', saleCents: 9900 };
  const FREE_CHAPTER = {
    id: 1,
    courseId: 1,
    title: '第一章',
    contentType: 'video',
    content: null,
    sortOrder: 1,
    isFree: true,
  };
  const PAID_CHAPTER = { ...FREE_CHAPTER, id: 2, title: '第二章', isFree: false };

  it('课程不存在抛 3001/404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(null);
    prisma.chapter.findFirst.mockResolvedValue(null);

    await expect(service.resolveChapterAccess(null, 99, 1)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });

  it('游客可看免费课程的任意章节', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(FREE_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(PAID_CHAPTER);

    await expect(service.resolveChapterAccess(null, 1, 2)).resolves.toEqual({
      chapter: PAID_CHAPTER,
      access: 'free',
    });
  });

  it('游客可看付费课程的免费章节', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PAID_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(FREE_CHAPTER);

    await expect(service.resolveChapterAccess(null, 1, 1)).resolves.toEqual({
      chapter: FREE_CHAPTER,
      access: 'free',
    });
  });

  it('游客看付费章节抛 2001/401，不泄露章节是否存在', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PAID_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(PAID_CHAPTER);

    await expect(service.resolveChapterAccess(null, 1, 2)).rejects.toMatchObject({
      bizCode: 2001,
      status: 401,
      message: '请先登录',
    });
  });

  it('登录未购看付费章节抛 3002/403', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PAID_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(PAID_CHAPTER);
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(false);

    await expect(service.resolveChapterAccess(9, 1, 2)).rejects.toMatchObject({
      bizCode: 3002,
      status: 403,
      message: '请先购买课程',
    });
  });

  it('已购用户看付费章节返回 paid，下架课程也放行', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({
      ...PAID_COURSE,
      status: 'unpublished',
    });
    prisma.chapter.findFirst.mockResolvedValue(PAID_CHAPTER);
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    await expect(service.resolveChapterAccess(9, 1, 2)).resolves.toEqual({
      chapter: PAID_CHAPTER,
      access: 'paid',
    });
  });

  it('已购用户章节不存在抛 3001/404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PAID_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(null);
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    await expect(service.resolveChapterAccess(9, 1, 99)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });

  it('免费开放条件满足但章节不存在抛 3001/404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(FREE_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(null);

    await expect(service.resolveChapterAccess(null, 1, 99)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });

  it('未发布付费课程对游客抛 2001/401', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({
      ...PAID_COURSE,
      status: 'draft',
    });
    prisma.chapter.findFirst.mockResolvedValue(FREE_CHAPTER);

    await expect(service.resolveChapterAccess(null, 1, 1)).rejects.toMatchObject({
      bizCode: 2001,
      status: 401,
    });
  });
});

describe('CourseService.getChapterContent', () => {
  const PUBLISHED_PAID = { id: 1, status: 'published', saleCents: 9900 };

  it('游客看付费章节抛 2001/401', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 2,
      title: '第二章',
      contentType: 'video',
      content: 'videos/ch2.mp4',
      sortOrder: 2,
      isFree: false,
    });

    await expect(service.getChapterContent(null, 1, 2)).rejects.toMatchObject({
      bizCode: 2001,
      status: 401,
    });
  });

  it('游客可读取免费章节正文', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 1,
      title: '第一章',
      contentType: 'video',
      content: 'videos/ch1.mp4',
      sortOrder: 1,
      isFree: true,
    });

    await expect(service.getChapterContent(null, 1, 1)).resolves.toEqual({
      id: 1,
      title: '第一章',
      contentType: 'video',
      content: 'https://signed/videos/ch1.mp4',
      sortOrder: 1,
    });
  });

  it('登录未购看付费章节抛 3002/403', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 2,
      title: '第二章',
      contentType: 'video',
      content: 'videos/ch2.mp4',
      sortOrder: 2,
      isFree: false,
    });
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(false);

    await expect(service.getChapterContent(9, 1, 2)).rejects.toMatchObject({
      bizCode: 3002,
      status: 403,
    });
  });

  it('已购返回签名正文', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 1,
      title: '第一章',
      contentType: 'video',
      content: 'videos/ch1.mp4',
      sortOrder: 1,
      isFree: false,
    });
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    await expect(service.getChapterContent(9, 1, 1)).resolves.toMatchObject({
      content: 'https://signed/videos/ch1.mp4',
    });
    expect(prisma.course.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { id: true, status: true, saleCents: true },
    });
  });

  it('章节正文为空时返回 null', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 3,
      title: '空章',
      contentType: 'video',
      content: null,
      sortOrder: 3,
      isFree: true,
    });

    await expect(service.getChapterContent(null, 1, 3)).resolves.toMatchObject({
      content: null,
    });
  });

  it('已购但章节不存在抛 3001/404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue(null);
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    await expect(service.getChapterContent(9, 1, 99)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });

  it('下架课程已购仍可访问正文', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({
      ...PUBLISHED_PAID,
      status: 'unpublished',
    });
    prisma.chapter.findFirst.mockResolvedValue({
      id: 2,
      title: '第二章',
      contentType: 'video',
      content: 'videos/ch2.mp4',
      sortOrder: 2,
      isFree: false,
    });
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    await expect(service.getChapterContent(9, 1, 2)).resolves.toMatchObject({
      title: '第二章',
      content: 'https://signed/videos/ch2.mp4',
    });
  });
});
