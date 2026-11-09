import { Injectable } from '@nestjs/common';
import { ActivityType } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { BizException } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceQuote, PricingStrategy } from '../../trade/pricing/pricing.types';

// 秒杀计价策略：价格取活动秒杀价，活动必须进行中、有效且与课程匹配
@Injectable()
export class FlashSalePricingStrategy implements PricingStrategy {
  // 策略负责的活动类型
  readonly activityType: ActivityType = 'flash_sale';

  // 构造函数：注入 Prisma 服务读取活动
  constructor(private readonly prisma: PrismaService) {}

  // 校验秒杀活动并给出报价；activityId 为秒杀活动 id
  async quote(input: {
    courseId: number; // 课程 id
    activityId: number | null; // 秒杀活动 id
  }): Promise<PriceQuote> {
    // 秒杀必须指定活动
    if (input.activityId === null) {
      throw new BizException(
        ErrorCode.ACTIVITY_NOT_STARTED,
        '秒杀活动未开始或已结束',
        422,
      );
    }

    // 活动必须存在且属于该课程
    const activity = await this.prisma.flashSaleActivity.findUnique({
      where: { id: input.activityId },
    });
    if (!activity || activity.courseId !== input.courseId) {
      throw new BizException(
        ErrorCode.ACTIVITY_NOT_STARTED,
        '秒杀活动未开始或已结束',
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
        '秒杀活动未开始或已结束',
        422,
      );
    }

    // 数据库已售罄时拒绝报价（Redis 预扣之外的兜底）
    if (activity.sold >= activity.stock) {
      throw new BizException(ErrorCode.STOCK_INSUFFICIENT, '已售罄', 422);
    }

    return {
      priceCents: activity.priceCents, // 当前价 = 秒杀价
      activityType: this.activityType, // flash_sale
      activityId: activity.id, // 订单落库即携带活动 id（限购键依赖）
    };
  }
}
