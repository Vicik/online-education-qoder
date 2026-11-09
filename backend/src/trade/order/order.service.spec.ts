import { ConfigService } from '@nestjs/config';
import { BizException } from '../../common/exceptions/biz.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { CouponUserService } from '../../promotion/coupon/coupon.user.service';
import { PaymentGateway } from '../payment/payment-gateway.interface';
import { PostPaymentHandler } from '../payment/post-payment-handler.interface';
import { PricingService } from '../pricing/pricing.service';
import { OrderService } from './order.service';

// 已发布课程（原价 199 元、售价 99 元）
const COURSE = {
  id: 1,
  name: 'TypeScript 系统入门',
  originalCents: 19900,
  saleCents: 9900,
  status: 'published',
};
// 普通购买报价
const NORMAL_QUOTE = {
  priceCents: 9900,
  activityType: 'normal',
  activityId: null,
};
// 秒杀报价（活动 id = 5）
const FLASH_QUOTE = {
  priceCents: 5900,
  activityType: 'flash_sale',
  activityId: 5,
};
// 数据库落库后的订单行
const CREATED_ORDER = {
  id: 10,
  orderNo: 'ZX202611091200000001',
  userId: 1,
  courseId: 1,
  activityType: 'normal',
  activityId: null,
  originalCents: 19900,
  currentCents: 9900,
  discountCents: 2000,
  paidCents: 7900,
  couponClaimId: 9,
  status: 'pending',
  paidAt: null,
  expiresAt: new Date(),
  purchaseKey: 'user:1:course:1',
  flashPurchaseKey: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// 内存幂等实现：同键重放直接返回首次结果（与 IdempotencyService 语义一致）
function createIdempotencyMock() {
  // 键 -> 首次结果
  const cache = new Map<string, unknown>();
  // 包裹业务逻辑的 run 方法
  const run = jest.fn(
    async (
      userId: number,
      key: string,
      endpoint: string,
      fn: () => Promise<unknown>,
    ) => {
      // 幂等唯一键
      const cacheKey = `${userId}:${key}:${endpoint}`;
      // 命中则返回首次结果
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      // 首次执行并缓存
      const result = await fn();
      cache.set(cacheKey, result);
      return result;
    },
  );
  return { run, cache };
}

// 构造测试依赖：Prisma / 计价 / 券 / 幂等 / 支付网关 / 配置 / 钩子
function setup() {
  const prisma = {
    course: { findUnique: jest.fn() },
    order: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    payment: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  // 单元测试以同一 mock 充当事务客户端
  prisma.$transaction.mockImplementation(
    async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
  );
  const strategy = { quote: jest.fn().mockResolvedValue(NORMAL_QUOTE) };
  const pricing = {
    resolve: jest.fn(() => strategy),
    couponDiscount: jest.fn(),
  };
  const coupons = { redeemInTx: jest.fn(), restoreInTx: jest.fn() };
  const idempotency = createIdempotencyMock();
  const gateway = { charge: jest.fn(), refund: jest.fn() };
  const config = { get: jest.fn(() => 15) };
  const handler = { activityType: 'normal', onPaid: jest.fn() };
  const restoreFlashStock = jest.fn().mockResolvedValue(undefined);
  const service = new OrderService(
    prisma as never,
    pricing as unknown as PricingService,
    coupons as unknown as CouponUserService,
    idempotency as unknown as IdempotencyService,
    gateway as unknown as PaymentGateway,
    config as unknown as ConfigService,
    [handler] as PostPaymentHandler[],
    restoreFlashStock,
  );
  return {
    prisma,
    pricing,
    strategy,
    coupons,
    idempotency,
    gateway,
    config,
    handler,
    restoreFlashStock,
    service,
  };
}

describe('OrderService.createOrder（服务端定价与落库）', () => {
  it('落库 originalCents/currentCents/discountCents/paidCents 与 purchaseKey', async () => {
    const { prisma, pricing, coupons, idempotency, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    pricing.couponDiscount.mockResolvedValue(2000);
    prisma.order.create.mockResolvedValue(CREATED_ORDER);

    const order = await service.createOrder(
      1,
      { courseId: 1, couponClaimId: 9 },
      'key-abc123',
    );

    expect(order).toMatchObject({
      id: 10,
      courseName: COURSE.name,
      status: 'pending',
      originalCents: 19900,
      currentCents: 9900,
      discountCents: 2000,
      paidCents: 7900,
    });
    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 1,
        courseId: 1,
        activityType: 'normal',
        activityId: null,
        originalCents: 19900,
        currentCents: 9900,
        discountCents: 2000,
        paidCents: 7900,
        couponClaimId: 9,
        purchaseKey: 'user:1:course:1',
        flashPurchaseKey: null,
        expiresAt: expect.any(Date),
      }),
    });
    // 订单号：ZX + 14 位时间戳 + 4 位随机数
    expect(
      (prisma.order.create.mock.calls[0][0] as { data: { orderNo: string } })
        .data.orderNo,
    ).toMatch(/^ZX\d{18}$/);
    // 未支付超时按配置 15 分钟
    const expiresAt = (
      prisma.order.create.mock.calls[0][0] as { data: { expiresAt: Date } }
    ).data.expiresAt;
    const ttlMs = expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(14 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000);
    // 券核销在创建事务内完成
    expect(coupons.redeemInTx).toHaveBeenCalledWith(prisma, 9, 1, 10);
    // 幂等端点固定为 POST /orders
    expect(idempotency.run).toHaveBeenCalledWith(
      1,
      'key-abc123',
      'POST /orders',
      expect.any(Function),
    );
  });

  it('不选券：discount=0，实付等于当前价', async () => {
    const { prisma, pricing, coupons, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    prisma.order.create.mockResolvedValue({
      ...CREATED_ORDER,
      discountCents: 0,
      paidCents: 9900,
      couponClaimId: null,
    });

    await service.createOrder(1, { courseId: 1 }, 'key-abc124');

    expect(pricing.couponDiscount).not.toHaveBeenCalled();
    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ discountCents: 0, paidCents: 9900 }),
    });
    expect(coupons.redeemInTx).not.toHaveBeenCalled();
  });

  it('券额大于当前价：实付为 0 仍生成订单', async () => {
    const { prisma, pricing, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    pricing.couponDiscount.mockResolvedValue(12000);
    prisma.order.create.mockResolvedValue({
      ...CREATED_ORDER,
      discountCents: 12000,
      paidCents: 0,
    });

    await service.createOrder(
      1,
      { courseId: 1, couponClaimId: 9 },
      'key-abc125',
    );

    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ discountCents: 12000, paidCents: 0 }),
    });
  });

  it('券不可用（4002）时不创建订单', async () => {
    const { prisma, pricing, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    pricing.couponDiscount.mockRejectedValue(
      new BizException(4002, '优惠券不可用', 422),
    );

    await expect(
      service.createOrder(1, { courseId: 1, couponClaimId: 9 }, 'key-abc126'),
    ).rejects.toMatchObject({ bizCode: 4002, status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('课程下架：422 且不创建订单', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({
      ...COURSE,
      status: 'unpublished',
    });

    await expect(
      service.createOrder(1, { courseId: 1 }, 'key-abc127'),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('重复购买：purchaseKey 唯一冲突抛 409（code=4003）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    prisma.order.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['purchaseKey'] },
    });

    await expect(
      service.createOrder(1, { courseId: 1 }, 'key-abc128'),
    ).rejects.toMatchObject({ bizCode: 4003, status: 409 });
  });

  it('同一张券被并发订单占用：couponClaimId 唯一冲突抛 422（code=4002）', async () => {
    const { prisma, pricing, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    pricing.couponDiscount.mockResolvedValue(2000);
    prisma.order.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['couponClaimId'] },
    });

    await expect(
      service.createOrder(1, { courseId: 1, couponClaimId: 9 }, 'key-abc129'),
    ).rejects.toMatchObject({ bizCode: 4002, status: 422 });
  });

  it('P2002 缺少冲突字段：回查 purchaseKey 判定重复购买 409', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    prisma.order.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: null },
    });
    prisma.order.findFirst.mockResolvedValue({ id: 99 });

    await expect(
      service.createOrder(1, { courseId: 1 }, 'key-abc131'),
    ).rejects.toMatchObject({ bizCode: 4003, status: 409 });
    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: { purchaseKey: 'user:1:course:1' },
      select: { id: true },
    });
  });

  it('P2002 缺少冲突字段：秒杀订单按购买键与限购键回查', async () => {
    const { prisma, strategy, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    strategy.quote.mockResolvedValue(FLASH_QUOTE);
    prisma.order.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: null },
    });
    prisma.order.findFirst.mockResolvedValue({ id: 99 });

    await expect(
      service.createOrder(
        1,
        { courseId: 1, activityType: 'flash_sale', activityId: 5 },
        'key-abc132',
      ),
    ).rejects.toMatchObject({ bizCode: 4003, status: 409 });
    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { purchaseKey: 'user:1:course:1' },
          { flashPurchaseKey: 'user:1:flash:5' },
        ],
      },
      select: { id: true },
    });
  });

  it('P2002 缺少冲突字段：券已被订单占用抛 422', async () => {
    const { prisma, pricing, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    pricing.couponDiscount.mockResolvedValue(2000);
    prisma.order.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: null },
    });
    // 第一次回查无重复订单，第二次回查命中券占用
    prisma.order.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 99 });

    await expect(
      service.createOrder(1, { courseId: 1, couponClaimId: 9 }, 'key-abc133'),
    ).rejects.toMatchObject({ bizCode: 4002, status: 422 });
    expect(prisma.order.findFirst).toHaveBeenLastCalledWith({
      where: { couponClaimId: 9 },
      select: { id: true },
    });
  });

  it('P2002 缺少冲突字段且无法判定：保留原始异常', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    prisma.order.create.mockRejectedValue({
      code: 'P2002',
      meta: { target: null },
    });
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(
      service.createOrder(1, { courseId: 1 }, 'key-abc134'),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('秒杀订单写入 flashPurchaseKey', async () => {
    const { prisma, pricing, strategy, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    strategy.quote.mockResolvedValue(FLASH_QUOTE);
    prisma.order.create.mockResolvedValue({
      ...CREATED_ORDER,
      activityType: 'flash_sale',
      activityId: 5,
      currentCents: 5900,
      paidCents: 5900,
      flashPurchaseKey: 'user:1:flash:5',
    });

    await service.createOrder(
      1,
      { courseId: 1, activityType: 'flash_sale', activityId: 5 },
      'key-abc130',
    );

    expect(pricing.resolve).toHaveBeenCalledWith('flash_sale');
    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        activityType: 'flash_sale',
        activityId: 5,
        flashPurchaseKey: 'user:1:flash:5',
      }),
    });
  });

  it('同幂等键重放返回首次结果且只下单一次', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(COURSE);
    prisma.order.create.mockResolvedValue(CREATED_ORDER);

    const first = await service.createOrder(1, { courseId: 1 }, 'key-replay1');
    const second = await service.createOrder(1, { courseId: 1 }, 'key-replay1');

    expect(second).toEqual(first);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
  });
});

// 带课程名称的订单行（pay/getOrder 查询会 include 课程）
const ORDER_WITH_COURSE = {
  ...CREATED_ORDER,
  course: { name: COURSE.name },
};
// 已支付订单行
const PAID_ORDER = {
  id: CREATED_ORDER.id,
  orderNo: CREATED_ORDER.orderNo,
  userId: 1,
  courseId: 1,
  activityType: 'normal',
  activityId: null,
  originalCents: 19900,
  currentCents: 9900,
  discountCents: 2000,
  paidCents: 7900,
  couponClaimId: 9,
  status: 'paid',
  paidAt: new Date(),
  expiresAt: null,
  purchaseKey: 'user:1:course:1',
  flashPurchaseKey: null,
  version: 2,
  createdAt: CREATED_ORDER.createdAt,
  updatedAt: new Date(),
};

describe('OrderService.pay（模拟支付与后处理钩子）', () => {
  it('支付成功：订单置 paid、写入 payments 台账、调用 handler', async () => {
    const { prisma, gateway, handler, service } = setup();
    prisma.order.findUnique.mockResolvedValue(ORDER_WITH_COURSE);
    gateway.charge.mockResolvedValue({ transactionNo: 'MOCK-0001' });
    prisma.order.update.mockResolvedValue(PAID_ORDER);
    prisma.payment.create.mockResolvedValue({});

    const paid = await service.pay(1, 10);

    expect(paid).toMatchObject({
      id: 10,
      status: 'paid',
      courseName: COURSE.name,
    });
    expect(gateway.charge).toHaveBeenCalledWith(ORDER_WITH_COURSE);
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { status: 'paid', paidAt: expect.any(Date) },
    });
    expect(prisma.payment.create).toHaveBeenCalledWith({
      data: {
        orderId: 10,
        channel: 'mock',
        transactionNo: 'MOCK-0001',
        amountCents: 7900,
      },
    });
    // 钩子在支付事务内、以更新后的订单调用
    expect(handler.onPaid).toHaveBeenCalledWith(prisma, PAID_ORDER);
  });

  it('已支付订单幂等：不重复扣款、不重启事务，返回首次结果', async () => {
    const { prisma, gateway, handler, service } = setup();
    prisma.order.findUnique.mockResolvedValue({
      ...PAID_ORDER,
      course: { name: COURSE.name },
    });

    const paid = await service.pay(1, 10);

    expect(paid).toMatchObject({ status: 'paid', courseName: COURSE.name });
    expect(gateway.charge).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(handler.onPaid).not.toHaveBeenCalled();
  });

  it('他人订单支付返回 403（code=2002）', async () => {
    const { prisma, gateway, service } = setup();
    prisma.order.findUnique.mockResolvedValue({
      ...ORDER_WITH_COURSE,
      userId: 2,
    });

    await expect(service.pay(1, 10)).rejects.toMatchObject({
      bizCode: 2002,
      status: 403,
    });
    expect(gateway.charge).not.toHaveBeenCalled();
  });

  it('订单不存在返回 403（防 IDOR 探测）', async () => {
    const { prisma, service } = setup();
    prisma.order.findUnique.mockResolvedValue(null);

    await expect(service.pay(1, 999)).rejects.toMatchObject({
      bizCode: 2002,
      status: 403,
    });
  });

  it('已取消订单不可支付（422）', async () => {
    const { prisma, gateway, service } = setup();
    prisma.order.findUnique.mockResolvedValue({
      ...ORDER_WITH_COURSE,
      status: 'cancelled',
    });

    await expect(service.pay(1, 10)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
    expect(gateway.charge).not.toHaveBeenCalled();
  });

  it('handler 抛错则支付事务回滚（订单保持 pending）', async () => {
    const { prisma, gateway, handler, service } = setup();
    prisma.order.findUnique.mockResolvedValue(ORDER_WITH_COURSE);
    gateway.charge.mockResolvedValue({ transactionNo: 'MOCK-0002' });
    handler.onPaid.mockRejectedValue(new BizException(4001, '库存不足', 422));

    // 记录“已提交”的订单状态，模拟事务回滚语义
    let committedStatus = 'pending';
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        // 进入事务前的快照
        const snapshot = committedStatus;
        try {
          return await fn({
            order: {
              update: async () => {
                committedStatus = 'paid';
                return PAID_ORDER;
              },
            },
            payment: { create: async () => ({}) },
          });
        } catch (error) {
          // 回滚：恢复快照
          committedStatus = snapshot;
          throw error;
        }
      },
    );

    await expect(service.pay(1, 10)).rejects.toMatchObject({ bizCode: 4001 });
    expect(committedStatus).toBe('pending');
  });

  it('并发支付撞上 payments 唯一约束：返回已支付结果', async () => {
    const { prisma, gateway, service } = setup();
    // 首次查询 pending，事务失败后重查为 paid
    prisma.order.findUnique
      .mockResolvedValueOnce(ORDER_WITH_COURSE)
      .mockResolvedValueOnce({
        ...PAID_ORDER,
        course: { name: COURSE.name },
      });
    gateway.charge.mockResolvedValue({ transactionNo: 'MOCK-0003' });
    prisma.$transaction.mockRejectedValue({ code: 'P2002' });

    const paid = await service.pay(1, 10);

    expect(paid.status).toBe('paid');
    expect(gateway.charge).toHaveBeenCalledTimes(1);
  });
});

describe('OrderService 查询（归属校验与分页）', () => {
  it('getOrder 返回本人订单详情', async () => {
    const { prisma, service } = setup();
    prisma.order.findUnique.mockResolvedValue(ORDER_WITH_COURSE);

    const order = await service.getOrder(1, 10);

    expect(order).toMatchObject({
      id: 10,
      courseName: COURSE.name,
      status: 'pending',
    });
    expect(prisma.order.findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      include: { course: { select: { name: true } } },
    });
  });

  it('getOrder 他人订单返回 403（code=2002）', async () => {
    const { prisma, service } = setup();
    prisma.order.findUnique.mockResolvedValue({
      ...ORDER_WITH_COURSE,
      userId: 2,
    });

    await expect(service.getOrder(1, 10)).rejects.toMatchObject({
      bizCode: 2002,
      status: 403,
    });
  });

  it('listUserOrders 仅查本人订单并映射课程名', async () => {
    const { prisma, service } = setup();
    prisma.order.findMany.mockResolvedValue([ORDER_WITH_COURSE]);
    prisma.order.count.mockResolvedValue(1);

    const page = await service.listUserOrders(1, { page: 2, pageSize: 10 });

    expect(page).toMatchObject({ total: 1, page: 2, pageSize: 10 });
    expect(page.items[0]).toMatchObject({
      id: 10,
      courseName: COURSE.name,
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 1 },
        skip: 10,
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(prisma.order.count).toHaveBeenCalledWith({ where: { userId: 1 } });
  });

  it('listUserOrders 分页参数兜底为 1/20', async () => {
    const { prisma, service } = setup();
    prisma.order.findMany.mockResolvedValue([]);
    prisma.order.count.mockResolvedValue(0);

    const page = await service.listUserOrders(1, {});

    expect(page).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
  });

  it('listAllOrders 联查用户信息', async () => {
    const { prisma, service } = setup();
    prisma.order.findMany.mockResolvedValue([
      {
        ...ORDER_WITH_COURSE,
        user: { id: 1, email: 'user@example.com', nickname: '学员小明' },
      },
    ]);
    prisma.order.count.mockResolvedValue(1);

    const page = await service.listAllOrders({ page: 1, pageSize: 20 });

    expect(page.items[0]).toMatchObject({
      id: 10,
      courseName: COURSE.name,
      user: { email: 'user@example.com', nickname: '学员小明' },
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          course: { select: { name: true } },
          user: { select: { id: true, email: true, nickname: true } },
        },
      }),
    );
  });
});

describe('OrderService.cancelExpiredOrders（Worker 订单超时）', () => {
  const NOW = new Date('2026-11-09T12:00:00Z');

  it('pending 过期 → cancelled + 券恢复 + 秒杀预占回补 + purchaseKey 置空', async () => {
    const { prisma, coupons, restoreFlashStock, service } = setup();
    prisma.order.findMany.mockResolvedValue([
      {
        id: 21,
        activityType: 'flash_sale',
        activityId: 5,
        couponClaimId: 9,
      },
    ]);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.cancelExpiredOrders(NOW)).resolves.toBe(1);

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { status: 'pending', expiresAt: { lt: NOW } },
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 21, status: 'pending' },
      data: {
        status: 'cancelled',
        purchaseKey: null,
        flashPurchaseKey: null,
      },
    });
    expect(coupons.restoreInTx).toHaveBeenCalledWith(prisma, 9);
    expect(restoreFlashStock).toHaveBeenCalledWith(5);
  });

  it('普通订单不触碰秒杀库存与券', async () => {
    const { prisma, coupons, restoreFlashStock, service } = setup();
    prisma.order.findMany.mockResolvedValue([
      { id: 22, activityType: 'normal', activityId: null, couponClaimId: null },
    ]);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.cancelExpiredOrders(NOW)).resolves.toBe(1);

    expect(restoreFlashStock).not.toHaveBeenCalled();
    expect(coupons.restoreInTx).not.toHaveBeenCalled();
  });

  it('状态条件未命中（已被支付/取消）时不重复释放资源', async () => {
    const { prisma, coupons, restoreFlashStock, service } = setup();
    prisma.order.findMany.mockResolvedValue([
      { id: 23, activityType: 'flash_sale', activityId: 6, couponClaimId: 10 },
    ]);
    prisma.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.cancelExpiredOrders(NOW)).resolves.toBe(0);

    expect(restoreFlashStock).not.toHaveBeenCalled();
    expect(coupons.restoreInTx).not.toHaveBeenCalled();
  });

  it('秒杀订单缺少活动 id 时不回补库存', async () => {
    const { prisma, restoreFlashStock, service } = setup();
    prisma.order.findMany.mockResolvedValue([
      {
        id: 24,
        activityType: 'flash_sale',
        activityId: null,
        couponClaimId: null,
      },
    ]);
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.cancelExpiredOrders(NOW)).resolves.toBe(1);

    expect(restoreFlashStock).not.toHaveBeenCalled();
  });

  it('多条订单跳过已处理项，只统计实际取消数', async () => {
    const { prisma, service } = setup();
    prisma.order.findMany.mockResolvedValue([
      { id: 25, activityType: 'normal', activityId: null, couponClaimId: null },
      { id: 26, activityType: 'normal', activityId: null, couponClaimId: null },
    ]);
    prisma.order.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(service.cancelExpiredOrders(NOW)).resolves.toBe(1);
  });
});
