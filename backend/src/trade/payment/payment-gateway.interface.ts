import type { Order, Payment } from '@prisma/client';

// 支付网关抽象：模拟支付恒成功，真实渠道（微信/支付宝）按此接口实现
export interface PaymentGateway {
  /** 发起支付：返回渠道流水号（mock 恒成功） */
  charge(order: Order): Promise<{ transactionNo: string }>;
  /** 退款：拼团失败等场景由步骤 12 调用（真实渠道预留） */
  refund(order: Order, payment: Payment): Promise<{ transactionNo: string }>;
}

// 支付网关 DI token：真实渠道实现只需替换该 token 的 provider
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
