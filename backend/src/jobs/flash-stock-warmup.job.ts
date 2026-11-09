import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FlashStockService } from '../promotion/flash-sale/flash-stock.service';
import { Job } from './jobs.scheduler';

// 秒杀库存预热任务：活动进入进行中后把剩余库存写入 Redis（SET 覆盖即幂等）
@Injectable()
export class FlashStockWarmupJob implements Job {
  // 任务名：同时作为分布式锁键后缀
  readonly name = 'flash-stock-warmup';

  // 构造函数：注入数据库与 Redis 库存服务
  constructor(
    private readonly prisma: PrismaService, // 查询进行中的活动
    private readonly stock: FlashStockService, // 写入预占计数
  ) {}

  // 执行一轮扫描：返回预热的活动数
  async run(now: Date): Promise<number> {
    // 先推进未开始→进行中（与 activity-status 重复但保持本任务自洽）
    await this.prisma.flashSaleActivity.updateMany({
      where: {
        status: 'not_started',
        startAt: { lte: now },
        endAt: { gt: now },
      },
      data: { status: 'ongoing' },
    });

    // 处于有效进行期的活动：预热其剩余库存
    const activities = await this.prisma.flashSaleActivity.findMany({
      where: {
        status: 'ongoing',
        startAt: { lte: now },
        endAt: { gt: now },
      },
    });

    for (const activity of activities) {
      // 剩余库存 = 总库存 − 已售（数据库为权威口径）
      const remaining = activity.stock - activity.sold;
      // SET 覆盖写入：重复预热结果一致
      await this.stock.warmup(activity.id, remaining);
    }

    return activities.length;
  }
}
