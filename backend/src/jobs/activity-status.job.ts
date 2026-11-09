import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Job } from './jobs.scheduler';

// 活动状态流转任务：拼团与秒杀按起止时间推进 not_started→ongoing→ended
@Injectable()
export class ActivityStatusJob implements Job {
  // 任务名：同时作为分布式锁键后缀
  readonly name = 'activity-status';

  // 构造函数：注入数据库
  constructor(private readonly prisma: PrismaService) {}

  // 执行一轮扫描：先开播再结束，保证错过开始时间的活动同轮也能进入 ended
  async run(now: Date): Promise<number> {
    // 拼团：未开始且已到开始时间 → 进行中
    const grouponStarted = await this.prisma.grouponActivity.updateMany({
      where: { status: 'not_started', startAt: { lte: now } },
      data: { status: 'ongoing' },
    });
    // 拼团：进行中且已过结束时间 → 已结束
    const grouponEnded = await this.prisma.grouponActivity.updateMany({
      where: { status: 'ongoing', endAt: { lt: now } },
      data: { status: 'ended' },
    });
    // 秒杀：未开始且已到开始时间 → 进行中
    const flashStarted = await this.prisma.flashSaleActivity.updateMany({
      where: { status: 'not_started', startAt: { lte: now } },
      data: { status: 'ongoing' },
    });
    // 秒杀：进行中且已过结束时间 → 已结束
    const flashEnded = await this.prisma.flashSaleActivity.updateMany({
      where: { status: 'ongoing', endAt: { lt: now } },
      data: { status: 'ended' },
    });
    // 四个条件更新的处理数之和
    return (
      grouponStarted.count +
      grouponEnded.count +
      flashStarted.count +
      flashEnded.count
    );
  }
}
