import { Injectable } from '@nestjs/common';
import { ActivityType } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { BizException } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceQuote, PricingStrategy } from '../../trade/pricing/pricing.types';

// 拼团计价策略：价格取活动拼团价，活动必须进行中且与课程匹配
@Injectable()
export class GrouponPricingStrategy implements PricingStrategy {
  // 策略负责的活动类型
  readonly activityType: ActivityType = 'groupon';

  // 构造函数：注入 Prisma 服务读取活动
  constructor(private readonly prisma: PrismaService) {}

  // 校验拼团活动并给出报价；activityId 为拼团活动 id
  async quote(input: {
    courseId: number; // 课程 id
    activityId: number | null; // 拼团活动 id
  }): Promise<PriceQuote> {
    // 拼团必须指定活动
    if (input.activityId === null) {
      throw new BizException(
        ErrorCode.ACTIVITY_NOT_STARTED,
        '拼团活动未开始或已结束',
        422,
      );
    }

    // 活动必须存在且属于该课程
    const activity = await this.prisma.grouponActivity.findUnique({
      where: { id: input.activityId },
    });
    if (!activity || activity.courseId !== input.courseId) {
      throw new BizException(
        ErrorCode.ACTIVITY_NOT_STARTED,
        '拼团活动未开始或已结束',
        422,
      );
    }

    // 仅进行中且在有效期内可计价
    const now = new Date();
    if (
      activity.status !== 'ongoing' ||
      activity.startAt.getTime() > now.getTime() ||
      activity.endAt.getTime() <= now.getTime()
    ) {
      throw new BizException(
        ErrorCode.ACTIVITY_NOT_STARTED,
        '拼团活动未开始或已结束',
        422,
      );
    }

    return {
      priceCents: activity.priceCents, // 当前价 = 拼团价
      activityType: this.activityType, // groupon
      // 订单落库后再回写团组 id，报价阶段不携带活动 id
      activityId: null,
    };
  }
}
