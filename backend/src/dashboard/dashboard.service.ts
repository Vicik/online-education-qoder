import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// 工作台统计响应：与 openapi DashboardStats 一致
export interface DashboardStats {
  userCount: number;
  courseCount: number;
  publishedCourseCount: number;
  orderCount: number;
  paidOrderCount: number;
  revenueCents: number;
  ongoingGrouponCount: number;
  ongoingFlashSaleCount: number;
}

// 工作台统计服务：一次事务内聚合并发八项口径
@Injectable()
export class DashboardService {
  // 构造函数：注入 Prisma
  constructor(private readonly prisma: PrismaService) {}

  // 统计总数、已支付与收入；进行中活动要求状态 ongoing 且未过期
  async stats(): Promise<DashboardStats> {
    // 统计基准时间：活动需 endAt 晚于当前
    const now = new Date();
    // 同一事务快照内取数，避免口径时间点不一致
    const [
      userCount,
      courseCount,
      publishedCourseCount,
      orderCount,
      paidOrderCount,
      revenue,
      ongoingGrouponCount,
      ongoingFlashSaleCount,
    ] = await this.prisma.$transaction([
      // 用户仅统计普通角色（含停用）
      this.prisma.user.count({ where: { role: 'user' } }),
      // 课程总数（全部状态）
      this.prisma.course.count(),
      // 已发布课程
      this.prisma.course.count({ where: { status: 'published' } }),
      // 订单总数（全部状态）
      this.prisma.order.count(),
      // 已支付订单
      this.prisma.order.count({ where: { status: 'paid' } }),
      // 已支付订单实付额之和
      this.prisma.order.aggregate({
        _sum: { paidCents: true },
        where: { status: 'paid' },
      }),
      // 进行中拼团：状态 ongoing 且未过期
      this.prisma.grouponActivity.count({
        where: { status: 'ongoing', endAt: { gt: now } },
      }),
      // 进行中秒杀：状态 ongoing 且未过期
      this.prisma.flashSaleActivity.count({
        where: { status: 'ongoing', endAt: { gt: now } },
      }),
    ]);

    return {
      userCount,
      courseCount,
      publishedCourseCount,
      orderCount,
      paidOrderCount,
      revenueCents: revenue._sum.paidCents ?? 0,
      ongoingGrouponCount,
      ongoingFlashSaleCount,
    };
  }
}
