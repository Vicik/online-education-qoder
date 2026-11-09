import type { OrderService } from '../trade/order/order.service';
import { OrderTimeoutJob } from './order-timeout.job';

describe('OrderTimeoutJob', () => {
  it('调用 cancelExpiredOrders(now) 并返回处理数', async () => {
    const orders = {
      cancelExpiredOrders: jest.fn().mockResolvedValue(2),
    };
    const job = new OrderTimeoutJob(orders as unknown as OrderService);
    const now = new Date();

    await expect(job.run(now)).resolves.toBe(2);
    expect(orders.cancelExpiredOrders).toHaveBeenCalledWith(now);
  });
});
