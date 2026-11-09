import { Injectable } from '@nestjs/common';
import type { ActivityType, Order, Prisma } from '@prisma/client';

// 支付后处理钩子：各活动类型在支付成功事务内完成自己的副作用
export interface PostPaymentHandler {
  readonly activityType: ActivityType; // 处理的活动类型
  /** 支付成功事务内调用；抛错则整个支付事务回滚 */
  onPaid(tx: Prisma.TransactionClient, order: Order): Promise<void>;
  /** 支付事务回滚后调用：释放下单时预占的资源（如秒杀库存） */
  onPaidFailed?(order: Order): Promise<void>;
}

// 支付后处理钩子多提供者 token：各活动模块通过 multi provider 注册
export const POST_PAYMENT_HANDLERS = Symbol('POST_PAYMENT_HANDLERS');

// 普通订单的支付后处理：支付即授予学习权限，无额外副作用
@Injectable()
export class NormalPostPaymentHandler implements PostPaymentHandler {
  readonly activityType: ActivityType = 'normal';

  // 空实现：普通订单支付事务只需更新订单与支付台账
  async onPaid(_tx: Prisma.TransactionClient, _order: Order): Promise<void> {
    // 无需处理
  }
}
