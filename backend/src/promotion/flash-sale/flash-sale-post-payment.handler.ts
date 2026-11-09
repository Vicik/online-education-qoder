import { Injectable } from '@nestjs/common';
import type { ActivityType, Order, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { BizException } from '../../common/exceptions/biz.exception';
import { PostPaymentHandler } from '../../trade/payment/post-payment-handler.interface';
import { RedisService } from '../../redis/redis.service';
import { FLASH_STOCK_KEY_PREFIX } from './flash-stock.service';

// 秒杀支付后处理：行锁内 sold+1，DB 侧兜底防超卖（§9.1）
@Injectable()
export class FlashSalePostPaymentHandler implements PostPaymentHandler {
  // 处理的活动类型
  readonly activityType: ActivityType = 'flash_sale';

  // 构造函数：注入 Redis（支付失败时回补预占）
  constructor(private readonly redis: RedisService) {}

  // 支付成功事务内调用：sold < stock 才允许扣减，行锁保证并发串行
  async onPaid(tx: Prisma.TransactionClient, order: Order): Promise<void> {
    // 非秒杀订单或缺少活动 id 不处理
    if (order.activityType !== 'flash_sale' || order.activityId === null) {
      return;
    }
    // 活动 id（非空收窄）
    const activityId = order.activityId;

    // 行锁读取活动：并发支付在这里串行化，避免 sold 越过 stock
    await tx.$queryRaw`SELECT id FROM flash_sale_activities WHERE id = ${activityId} FOR UPDATE`;
    // 行锁内的最新活动状态
    const activity = await tx.flashSaleActivity.findUnique({
      where: { id: activityId },
    });
    if (!activity) return;

    // 数据库已售罄：支付事务回滚，订单保持 pending
    if (activity.sold >= activity.stock) {
      throw new BizException(ErrorCode.STOCK_INSUFFICIENT, '已售罄', 422);
    }

    // 扣减一件库存
    await tx.flashSaleActivity.update({
      where: { id: activityId },
      data: { sold: { increment: 1 } },
    });
  }

  // 支付事务失败时调用：释放下单时的 Redis 预占
  async onPaidFailed(order: Order): Promise<void> {
    // 非秒杀订单或缺少活动 id 不处理
    if (order.activityType !== 'flash_sale' || order.activityId === null) {
      return;
    }
    // 回补一件预占库存
    await this.redis.incr(`${FLASH_STOCK_KEY_PREFIX}${order.activityId}`);
  }
}
