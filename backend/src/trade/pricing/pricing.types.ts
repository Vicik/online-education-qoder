import type { ActivityType } from '@prisma/client';

// 服务端报价结果：当前价 + 命中的活动信息
export interface PriceQuote {
  priceCents: number; // 当前价（售价/秒杀价/拼团价）
  activityType: ActivityType; // 定价活动类型
  activityId: number | null; // 活动 id（normal 为 null）
}

// 计价策略接口：每种活动类型实现自己的有效性校验与价格来源
export interface PricingStrategy {
  readonly activityType: ActivityType; // 策略负责的活动类型
  /** 校验活动有效性并给出当前价；无效抛 BizException(422 语义) */
  quote(input: {
    courseId: number; // 课程 id
    activityId: number | null; // 活动 id（normal 为 null）
  }): Promise<PriceQuote>;
}

// 计价策略多提供者 token：各活动模块通过 multi provider 注册策略
export const PRICING_STRATEGIES = Symbol('PRICING_STRATEGIES');

// 价格预览响应：与 openapi CheckoutPreviewData 一致
export interface CheckoutPreviewData {
  courseId: number; // 课程 id
  activityType: ActivityType; // 活动类型
  activityId: number | null; // 活动 id
  originalCents: number; // 课程原价（分）
  currentCents: number; // 当前价（分）
  discountCents: number; // 券抵扣额（分）
  paidCents: number; // 实付 = max(0, 当前价 − 券额)
  couponClaimId: number | null; // 使用的券领取记录 id
}
