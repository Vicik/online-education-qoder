import { Injectable } from '@nestjs/common';
import type { ActivityType, Order, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { BizException } from '../../common/exceptions/biz.exception';
import { PostPaymentHandler } from '../../trade/payment/post-payment-handler.interface';

// 拼团支付后处理：团组行锁内计团，满员原子成团（§9.2）
@Injectable()
export class GrouponPostPaymentHandler implements PostPaymentHandler {
  // 处理的活动类型
  readonly activityType: ActivityType = 'groupon';

  // 支付成功事务内调用：计数满员则成团，满员后付款直接拒绝
  async onPaid(tx: Prisma.TransactionClient, order: Order): Promise<void> {
    // 非拼团订单不处理
    if (order.activityType !== 'groupon') return;

    // 仅拼团成员订单需要计团；其他订单防御性跳过
    const member = await tx.grouponMember.findUnique({
      where: { orderId: order.id },
    });
    if (!member) return;

    // 团组行锁：并发支付串行化，避免满员判断竞态
    await tx.$queryRaw`SELECT id FROM groupon_groups WHERE id = ${member.groupId} FOR UPDATE`;

    // 行锁内读取最新团组状态
    const group = await tx.grouponGroup.findUnique({
      where: { id: member.groupId },
    });
    if (!group) return;
    // 已成团/已失败：支付前名额已被他人占满，拒绝本次支付
    if (group.status !== 'pending') {
      throw new BizException(ErrorCode.GROUP_FULL, '该团已满或已结束', 422);
    }

    // 活动提供成团人数
    const activity = await tx.grouponActivity.findUnique({
      where: { id: member.activityId },
    });
    if (!activity) return;

    // 本次支付成功后的成员数
    const nextCount = group.memberCount + 1;
    // 是否达到成团人数
    const full = nextCount >= activity.targetSize;

    await tx.grouponGroup.update({
      where: { id: group.id },
      data: {
        memberCount: nextCount,
        // 满员：原子成团并记录成团时间
        ...(full ? { status: 'success', formedAt: new Date() } : {}),
      },
    });
  }
}
