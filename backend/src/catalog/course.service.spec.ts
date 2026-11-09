import { PrismaService } from '../prisma/prisma.service';
import { CourseService } from './course.service';

// 构建被测服务及 Prisma 替身
function setup() {
  const prisma = {
    order: { findFirst: jest.fn() },
    course: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
    chapter: { findMany: jest.fn(), findFirst: jest.fn() },
    grouponActivity: { findFirst: jest.fn() },
    flashSaleActivity: { findFirst: jest.fn() },
    couponTemplate: { findMany: jest.fn() },
  };
  const service = new CourseService(prisma as unknown as PrismaService);
  return { prisma, service };
}

// 课程列表/详情测试共用的课程行数据
const courseRow = {
  id: 1,
  name: 'TypeScript 系统入门',
  type: 'video',
  coverUrl: null,
  instructor: '张老师',
  originalCents: 19900,
  saleCents: 9900,
  status: 'published',
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
  it('listPublished 只查 status=published 且分页', async () => {
    const { prisma, service } = setup();
    prisma.course.findMany.mockResolvedValue([courseRow]);
    prisma.course.count.mockResolvedValue(1);

    await expect(
      service.listPublished({ page: 1, pageSize: 20 }),
    ).resolves.toEqual({
      items: [courseRow],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'published' },
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
      intro: '课程简介',
      detailRich: '<p>详情</p>',
    });
    prisma.chapter.findMany.mockResolvedValue([
      { id: 1, title: '第一章', contentType: 'video', sortOrder: 1 },
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

    expect(detail.chapters[0]).not.toHaveProperty('content');
    expect(detail.chapters[0]).toEqual({
      id: 1,
      title: '第一章',
      contentType: 'video',
      sortOrder: 1,
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

  it('getDetail 非已发布课程抛 3001/404（游客视角）', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue(null);

    await expect(service.getDetail(1)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });
});

describe('CourseService.listRecommendations', () => {
  it('listRecommendations 取最近 8 条已发布', async () => {
    const { prisma, service } = setup();
    prisma.course.findMany.mockResolvedValue([courseRow]);

    await expect(service.listRecommendations()).resolves.toEqual([courseRow]);
    expect(prisma.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'published' },
        take: 8,
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});

describe('CourseService.getChapterContent', () => {
  it('getChapterContent 未购抛 3002/403', async () => {
    const { service } = setup();
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(false);

    await expect(service.getChapterContent(1, 1, 1)).rejects.toMatchObject({
      bizCode: 3002,
      status: 403,
    });
  });

  it('已购返回正文', async () => {
    const { prisma, service } = setup();
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 1,
      title: '第一章',
      contentType: 'video',
      content: 'videos/ch1.mp4',
      sortOrder: 1,
    });

    await expect(service.getChapterContent(1, 1, 1)).resolves.toEqual({
      id: 1,
      title: '第一章',
      contentType: 'video',
      content: 'videos/ch1.mp4',
      sortOrder: 1,
    });
    expect(prisma.chapter.findFirst).toHaveBeenCalledWith({
      where: { id: 1, courseId: 1 },
    });
  });

  it('已购但章节不存在抛 3001/404', async () => {
    const { prisma, service } = setup();
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);
    prisma.chapter.findFirst.mockResolvedValue(null);

    await expect(service.getChapterContent(1, 1, 99)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });

  it('下架课程已购仍可访问正文', async () => {
    const { prisma, service } = setup();
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 2,
      title: '第二章',
      contentType: 'video',
      content: 'videos/ch2.mp4',
      sortOrder: 2,
    });

    await expect(service.getChapterContent(1, 1, 2)).resolves.toMatchObject({
      title: '第二章',
      content: 'videos/ch2.mp4',
    });
    // 不校验课程状态：下架不影响已购用户学习
    expect(prisma.course.findFirst).not.toHaveBeenCalled();
  });
});
