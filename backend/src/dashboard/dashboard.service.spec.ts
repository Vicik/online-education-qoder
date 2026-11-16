import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from './dashboard.service';

// 构造统计服务与 Prisma 桩
function setup() {
  const prisma = {
    user: { count: jest.fn() },
    course: { count: jest.fn() },
    order: { count: jest.fn(), aggregate: jest.fn() },
    grouponActivity: { count: jest.fn() },
    flashSaleActivity: { count: jest.fn() },
    $transaction: jest.fn(),
  };
  // 数组形式的 $transaction：按顺序执行并返回结果
  prisma.$transaction.mockImplementation(
    async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  );
  const service = new DashboardService(prisma as unknown as PrismaService);
  return { prisma, service };
}

describe('DashboardService.stats', () => {
  it('按口径聚合八项统计', async () => {
    const { prisma, service } = setup();
    prisma.user.count.mockResolvedValue(12);
    prisma.course.count.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
    prisma.order.count.mockResolvedValueOnce(9).mockResolvedValueOnce(4);
    prisma.order.aggregate.mockResolvedValue({
      _sum: { paidCents: 12345 },
    });
    prisma.grouponActivity.count.mockResolvedValue(2);
    prisma.flashSaleActivity.count.mockResolvedValue(1);

    await expect(service.stats()).resolves.toEqual({
      userCount: 12,
      courseCount: 5,
      publishedCourseCount: 3,
      orderCount: 9,
      paidOrderCount: 4,
      revenueCents: 12345,
      ongoingGrouponCount: 2,
      ongoingFlashSaleCount: 1,
    });

    // 用户仅统计普通角色
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { role: 'user' },
    });
    // 课程总数与已发布数
    expect(prisma.course.count).toHaveBeenNthCalledWith(1);
    expect(prisma.course.count).toHaveBeenNthCalledWith(2, {
      where: { status: 'published' },
    });
    // 订单总数与已支付数
    expect(prisma.order.count).toHaveBeenNthCalledWith(1);
    expect(prisma.order.count).toHaveBeenNthCalledWith(2, {
      where: { status: 'paid' },
    });
    // 收入为已支付订单实付额之和
    expect(prisma.order.aggregate).toHaveBeenCalledWith({
      _sum: { paidCents: true },
      where: { status: 'paid' },
    });
    // 进行中活动：状态 ongoing 且未过期
    expect(prisma.grouponActivity.count).toHaveBeenCalledWith({
      where: { status: 'ongoing', endAt: { gt: expect.any(Date) } },
    });
    expect(prisma.flashSaleActivity.count).toHaveBeenCalledWith({
      where: { status: 'ongoing', endAt: { gt: expect.any(Date) } },
    });
  });

  it('空表时收入为 0 而非 null', async () => {
    const { prisma, service } = setup();
    prisma.user.count.mockResolvedValue(0);
    prisma.course.count.mockResolvedValue(0);
    prisma.order.count.mockResolvedValue(0);
    prisma.order.aggregate.mockResolvedValue({ _sum: { paidCents: null } });
    prisma.grouponActivity.count.mockResolvedValue(0);
    prisma.flashSaleActivity.count.mockResolvedValue(0);

    await expect(service.stats()).resolves.toMatchObject({
      revenueCents: 0,
    });
  });
});
