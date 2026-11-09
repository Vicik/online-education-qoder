import { MockPaymentGateway } from './mock-payment.gateway';
import { NormalPostPaymentHandler } from './post-payment-handler.interface';

// 最小订单/支付对象：网关实现不读取业务字段
const ORDER = { id: 10 } as never;
// 最小支付记录对象
const PAYMENT = { id: 1 } as never;

describe('MockPaymentGateway', () => {
  it('charge 恒成功并返回唯一的 MOCK 流水号', async () => {
    const gateway = new MockPaymentGateway();

    const first = await gateway.charge(ORDER);
    const second = await gateway.charge(ORDER);

    expect(first.transactionNo).toMatch(/^MOCK-[0-9a-f-]{36}$/);
    expect(second.transactionNo).toMatch(/^MOCK-[0-9a-f-]{36}$/);
    expect(first.transactionNo).not.toBe(second.transactionNo);
  });

  it('refund 返回独立的退款流水号', async () => {
    const gateway = new MockPaymentGateway();

    const result = await gateway.refund(ORDER, PAYMENT);

    expect(result.transactionNo).toMatch(/^MOCK-REF-[0-9a-f-]{36}$/);
  });
});

describe('NormalPostPaymentHandler', () => {
  it('普通订单支付成功无额外副作用', async () => {
    const handler = new NormalPostPaymentHandler();

    expect(handler.activityType).toBe('normal');
    await expect(
      handler.onPaid({} as never, ORDER as never),
    ).resolves.toBeUndefined();
  });
});
