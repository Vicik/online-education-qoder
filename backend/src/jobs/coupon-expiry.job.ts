import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Job } from './jobs.scheduler';

// 券过期任务：模板结束时间已过的可用券统一置为 expired
@Injectable()
export class CouponExpiryJob implements Job {
  // 任务名：同时作为分布式锁键后缀
  readonly name = 'coupon-expiry';

  // 构造函数：注入数据库
  constructor(private readonly prisma: PrismaService) {}

  // 执行一轮扫描：只处理未失效状态，返回标记条数
  async run(now: Date): Promise<number> {
    // 条件更新：状态过滤保证重复扫描幂等；claimKey 保留以继续阻止再领
    const { count } = await this.prisma.couponClaim.updateMany({
      where: {
        status: { in: ['unused', 'restored'] },
        template: { endAt: { lt: now } },
      },
      data: { status: 'expired' },
    });
    return count;
  }
}
