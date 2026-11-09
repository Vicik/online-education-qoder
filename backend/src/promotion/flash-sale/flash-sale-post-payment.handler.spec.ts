import type { Order, Prisma } from '@prisma/client';
import { RedisService } from '../../redis/redis.service';
import { FlashSalePostPaymentHandler } from './flash-sale-post-payment.handler';

const ORDER = {
  id: 30,
  orderNo: 'ZX-30',
  userId: 1,
  courseId: 1,
  activityType: 'flash_sale',
  activityId: 5,
  originalCents: 19900,
  currentCents: 5900,
  discountCents: 0,
  paidCents: 5900,
  couponClaimId: null,
  status: 'pending',
  paidAt: null,
  expiresAt: null,
  version: 1,
  purchaseKey: 'user:1:course:1',
  flashPurchaseKey: 'user:1:flash:5',
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Order;

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 5 }]),
    flashSaleActivity: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const redis = { incr: jest.fn().mockResolvedValue(1) };
  const handler = new FlashSalePostPaymentHandler(
    redis as unknown as RedisService,
  );
  return { tx, redis, handler };
}

describe('FlashSalePostPaymentHandler.onPaid', () => {
  it('sold < stock：行锁内 sold+1', async () => {
    const { tx, handler } = setup();
    tx.flashSaleActivity.findUnique.mockResolvedValue({
      id: 5,
      stock: 10,
      sold: 4,
    });

    await handler.onPaid(tx as unknown as Prisma.TransactionClient, ORDER);

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.flashSaleActivity.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { sold: { increment: 1 } },
    });
  });

  it('sold ≥ stock：抛 4001 且不扣减（支付事务回滚）', async () => {
    const { tx, handler } = setup();
    tx.flashSaleActivity.findUnique.mockResolvedValue({
      id: 5,
      stock: 10,
      sold: 10,
    });

    await expect(
      handler.onPaid(tx as unknown as Prisma.TransactionClient, ORDER),
    ).rejects.toMatchObject({ bizCode: 4001, status: 422 });
    expect(tx.flashSaleActivity.update).not.toHaveBeenCalled();
  });

  it('非秒杀订单不处理', async () => {
    const { tx, handler } = setup();

    await handler.onPaid(
      tx as unknown as Prisma.TransactionClient,
      {
        ...ORDER,
        activityType: 'normal',
        activityId: null,
      } as unknown as Order,
    );

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('活动不存在时跳过', async () => {
    const { tx, handler } = setup();
    tx.flashSaleActivity.findUnique.mockResolvedValue(null);

    await handler.onPaid(tx as unknown as Prisma.TransactionClient, ORDER);

    expect(tx.flashSaleActivity.update).not.toHaveBeenCalled();
  });
});

describe('FlashSalePostPaymentHandler.onPaidFailed', () => {
  it('秒杀订单回补 Redis 预占', async () => {
    const { redis, handler } = setup();

    await handler.onPaidFailed(ORDER);

    expect(redis.incr).toHaveBeenCalledWith('flash:stock:5');
  });

  it('非秒杀订单不回补', async () => {
    const { redis, handler } = setup();

    await handler.onPaidFailed({
      ...ORDER,
      activityType: 'normal',
      activityId: null,
    } as unknown as Order);

    expect(redis.incr).not.toHaveBeenCalled();
  });
});
