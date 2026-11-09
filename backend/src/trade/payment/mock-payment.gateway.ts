import { Injectable } from '@nestjs/common';
import type { Order, Payment } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PaymentGateway } from './payment-gateway.interface';

// 模拟支付网关：恒成功，用于开发与演示；真实渠道按 PaymentGateway 接口替换
@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  // 发起支付：生成唯一模拟流水号，不实际扣款
  async charge(_order: Order): Promise<{ transactionNo: string }> {
    return { transactionNo: `MOCK-${randomUUID()}` };
  }

  // 退款：生成唯一模拟退款流水号（步骤 12 拼团失败退款使用）
  async refund(
    _order: Order,
    _payment: Payment,
  ): Promise<{ transactionNo: string }> {
    return { transactionNo: `MOCK-REF-${randomUUID()}` };
  }
}
