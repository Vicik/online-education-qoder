import { ErrorCode } from '../../common/constants/error-codes';
import { BizException } from '../../common/exceptions/biz.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderService } from '../../trade/order/order.service';
import { PricingService } from '../../trade/pricing/pricing.service';
import { FlashStockService } from './flash-stock.service';
import { FlashSaleUserService } from './flash-sale.user.service';

const HOUR_MS = 60 * 60 * 1000;

const ACTIVITY = {
  id: 1,
  courseId: 1,
  name: '限时秒杀',
  priceCents: 5900,
  stock: 50,
  sold: 0,
  startAt: new Date(Date.now() - HOUR_MS),
  endAt: new Date(Date.now() + HOUR_MS),
  status: 'ongoing',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ORDER = {
  id: 30,
  orderNo: 'ZX-30',
  courseId: 1,
  courseName: 'TypeScript 系统入门',
  activityType: 'flash_sale',
  activityId: 1,
  originalCents: 19900,
  currentCents: 5900,
  discountCents: 0,
  paidCents: 5900,
  couponClaimId: null,
  status: 'pending',
  paidAt: null,
  createdAt: new Date(),
};

function setup() {
  const prisma = {
    flashSaleActivity: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  const quote = jest.fn().mockResolvedValue({
    priceCents: 5900,
    activityType: 'flash_sale',
    activityId: 1,
  });
  const orders = { createOrderWithQuote: jest.fn() };
  const pricing = { resolve: jest.fn().mockReturnValue({ quote }) };
  const idempotency = {
    run: jest.fn(
      async (
        _userId: number,
        _key: string,
        _endpoint: string,
        fn: () => Promise<unknown>,
      ) => fn(),
    ),
  };
  const stock = {
    preDeduct: jest.fn(),
    restore: jest.fn().mockResolvedValue(undefined),
    remaining: jest.fn(),
  };

  const service = new FlashSaleUserService(
    prisma as unknown as PrismaService,
    orders as unknown as OrderService,
    pricing as unknown as PricingService,
    idempotency as unknown as IdempotencyService,
    stock as unknown as FlashStockService,
  );
  return { prisma, quote, orders, pricing, idempotency, stock, service };
}

describe('FlashSaleUserService.purchase', () => {
  it('预扣成功后创建订单（活动 id 写入限购键）', async () => {
    const { prisma, quote, orders, stock, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);
    stock.preDeduct.mockResolvedValue(true);
    orders.createOrderWithQuote.mockResolvedValue(ORDER);

    const result = await service.purchase(1, 1, 'key-flash-01');

    expect(result.order.id).toBe(30);
    expect(stock.preDeduct).toHaveBeenCalledWith(1);
    expect(quote).toHaveBeenCalledWith({ courseId: 1, activityId: 1 });
    expect(orders.createOrderWithQuote).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        priceCents: 5900,
        activityType: 'flash_sale',
        activityId: 1,
      }),
      { courseId: 1, activityType: 'flash_sale', activityId: 1 },
      'key-flash-01',
    );
  });

  it('预扣失败抛 4001 已售罄且不创建订单', async () => {
    const { prisma, orders, stock, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);
    stock.preDeduct.mockResolvedValue(false);

    await expect(service.purchase(1, 1, 'key-flash-02')).rejects.toMatchObject({
      bizCode: 4001,
      status: 422,
    });
    expect(orders.createOrderWithQuote).not.toHaveBeenCalled();
  });

  it('活动不存在返回 404；未开始/已结束抛 5002', async () => {
    const missing = setup();
    missing.prisma.flashSaleActivity.findUnique.mockResolvedValue(null);
    await expect(
      missing.service.purchase(1, 1, 'key-flash-03'),
    ).rejects.toMatchObject({ bizCode: 1002, status: 404 });

    for (const patch of [
      { status: 'not_started' },
      { status: 'ended' },
      { status: 'ongoing', endAt: new Date(Date.now() - HOUR_MS) },
      { status: 'ongoing', startAt: new Date(Date.now() + HOUR_MS) },
    ]) {
      const { prisma, stock, orders, service } = setup();
      prisma.flashSaleActivity.findUnique.mockResolvedValue({
        ...ACTIVITY,
        ...patch,
      });

      await expect(
        service.purchase(1, 1, 'key-flash-03'),
      ).rejects.toMatchObject({ bizCode: 5002, status: 422 });
      expect(stock.preDeduct).not.toHaveBeenCalled();
      expect(orders.createOrderWithQuote).not.toHaveBeenCalled();
    }
  });

  it('订单创建失败回补库存并抛原始错误', async () => {
    const { prisma, orders, stock, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);
    stock.preDeduct.mockResolvedValue(true);
    orders.createOrderWithQuote.mockRejectedValue(new Error('boom'));

    await expect(service.purchase(1, 1, 'key-flash-04')).rejects.toThrow(
      'boom',
    );
    expect(stock.restore).toHaveBeenCalledWith(1);
  });

  it('限购：flashPurchaseKey 唯一冲突抛 5003', async () => {
    const { prisma, orders, stock, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);
    stock.preDeduct.mockResolvedValue(true);
    orders.createOrderWithQuote.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['flashPurchaseKey'] },
    });

    await expect(service.purchase(1, 1, 'key-flash-05')).rejects.toMatchObject({
      bizCode: 5003,
      status: 409,
    });
    expect(stock.restore).toHaveBeenCalledWith(1);
  });

  it('订单服务已映射的重复购买（4003）同样转为 5003', async () => {
    const { prisma, orders, stock, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);
    stock.preDeduct.mockResolvedValue(true);
    orders.createOrderWithQuote.mockRejectedValue(
      new BizException(ErrorCode.DUPLICATE_PURCHASE, '您已购买过该课程', 409),
    );

    await expect(service.purchase(1, 1, 'key-flash-06')).rejects.toMatchObject({
      bizCode: 5003,
      status: 409,
    });
    expect(stock.restore).toHaveBeenCalledWith(1);
  });

  it('同幂等键重放返回首次订单且只预扣一次', async () => {
    const { prisma, orders, idempotency, stock, service } = setup();
    const cache = new Map<string, unknown>();
    idempotency.run.mockImplementation(
      async (
        userId: number,
        key: string,
        endpoint: string,
        fn: () => Promise<unknown>,
      ) => {
        const cacheKey = `${userId}:${endpoint}:${key}`;
        if (cache.has(cacheKey)) return cache.get(cacheKey);
        const result = await fn();
        cache.set(cacheKey, result);
        return result;
      },
    );
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);
    stock.preDeduct.mockResolvedValue(true);
    orders.createOrderWithQuote.mockResolvedValue(ORDER);

    const first = await service.purchase(1, 1, 'key-flash-07');
    const second = await service.purchase(1, 1, 'key-flash-07');

    expect(second.order.id).toBe(first.order.id);
    expect(stock.preDeduct).toHaveBeenCalledTimes(1);
    expect(orders.createOrderWithQuote).toHaveBeenCalledTimes(1);
  });
});

describe('FlashSaleUserService 查询', () => {
  it('活动列表含剩余库存（未开始/进行中）', async () => {
    const { prisma, stock, service } = setup();
    prisma.flashSaleActivity.findMany.mockResolvedValue([
      { ...ACTIVITY, course: { name: 'TypeScript 系统入门' } },
    ]);
    prisma.flashSaleActivity.count.mockResolvedValue(1);
    stock.remaining.mockResolvedValue(7);

    const page = await service.listActivities({ page: 1, pageSize: 20 });

    expect(page.items[0]).toMatchObject({
      id: 1,
      courseName: 'TypeScript 系统入门',
      remaining: 7,
    });
    expect(prisma.flashSaleActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['not_started', 'ongoing'] } },
      }),
    );
  });

  it('活动详情带剩余库存；不存在返回 404', async () => {
    const { prisma, stock, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(null);
    await expect(service.getActivity(1)).rejects.toMatchObject({
      bizCode: 1002,
      status: 404,
    });

    prisma.flashSaleActivity.findUnique.mockResolvedValue({
      ...ACTIVITY,
      course: { name: 'TypeScript 系统入门' },
    });
    stock.remaining.mockResolvedValue(49);

    const detail = await service.getActivity(1);

    expect(detail).toMatchObject({
      id: 1,
      stock: 50,
      sold: 0,
      remaining: 49,
    });
  });
});
