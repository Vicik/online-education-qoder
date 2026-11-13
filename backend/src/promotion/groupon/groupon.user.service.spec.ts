import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { OrderService } from '../../trade/order/order.service';
import { PaymentGateway } from '../../trade/payment/payment-gateway.interface';
import { PricingService } from '../../trade/pricing/pricing.service';
import { GrouponUserService } from './groupon.user.service';

const HOUR_MS = 60 * 60 * 1000;

const ACTIVITY = {
  id: 1,
  courseId: 1,
  name: '双人成团特惠',
  priceCents: 6900,
  targetSize: 2,
  startAt: new Date(Date.now() - HOUR_MS),
  endAt: new Date(Date.now() + HOUR_MS),
  status: 'ongoing',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ORDER = {
  id: 10,
  orderNo: 'ZX-1',
  courseId: 1,
  courseName: 'TypeScript 系统入门',
  activityType: 'groupon',
  activityId: null,
  originalCents: 19900,
  currentCents: 6900,
  discountCents: 0,
  paidCents: 6900,
  couponClaimId: null,
  status: 'pending',
  paidAt: null,
  createdAt: new Date(),
};

const GROUP = {
  id: 20,
  activityId: 1,
  status: 'pending',
  memberCount: 0,
  formedAt: null,
  expiresAt: ACTIVITY.endAt,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup() {
  const prisma = {
    grouponActivity: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    grouponGroup: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    grouponMember: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    order: { update: jest.fn() },
    payment: { findUnique: jest.fn(), update: jest.fn() },
    couponClaim: { update: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );

  const quote = jest.fn().mockResolvedValue({
    priceCents: 6900,
    activityType: 'groupon',
    activityId: null,
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
  const gateway = {
    refund: jest.fn().mockResolvedValue({ transactionNo: 'MOCK-REF-1' }),
  };
  const storage = {
    resolveUrl: jest.fn().mockResolvedValue(null),
  };

  const service = new GrouponUserService(
    prisma as unknown as PrismaService,
    orders as unknown as OrderService,
    pricing as unknown as PricingService,
    idempotency as unknown as IdempotencyService,
    gateway as unknown as PaymentGateway,
    storage as unknown as StorageService,
  );
  return { prisma, orders, pricing, idempotency, gateway, storage, service };
}

describe('GrouponUserService.createGroup', () => {
  it('开团成功：发起者为首成员、订单回写团组 id', async () => {
    const { prisma, orders, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponMember.findFirst.mockResolvedValue(null);
    orders.createOrderWithQuote.mockResolvedValue(ORDER);
    prisma.grouponGroup.create.mockResolvedValue(GROUP);
    prisma.grouponMember.create.mockResolvedValue({});
    prisma.order.update.mockResolvedValue({ ...ORDER, activityId: 20 });

    const result = await service.createGroup(1, 1, 'key-grp-0001');

    expect(result.group.id).toBe(20);
    expect(result.group.targetSize).toBe(2);
    expect(result.order.id).toBe(10);
    expect(prisma.grouponMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        groupId: 20,
        activityId: 1,
        userId: 1,
        orderId: 10,
      }),
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { activityId: 20 },
    });
  });

  it('活动未开始/已结束/已取消均拒绝开团（5002）', async () => {
    for (const patch of [
      { status: 'not_started' },
      { status: 'ended' },
      { status: 'cancelled' },
      { status: 'ongoing', endAt: new Date(Date.now() - HOUR_MS) },
    ]) {
      const { prisma, orders, service } = setup();
      prisma.grouponActivity.findUnique.mockResolvedValue({
        ...ACTIVITY,
        ...patch,
      });

      await expect(
        service.createGroup(1, 1, 'key-grp-0001'),
      ).rejects.toMatchObject({ bizCode: 5002, status: 422 });
      expect(orders.createOrderWithQuote).not.toHaveBeenCalled();
    }
  });

  it('活动不存在返回 404', async () => {
    const { prisma, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue(null);

    await expect(
      service.createGroup(1, 1, 'key-grp-0001'),
    ).rejects.toMatchObject({ bizCode: 1002, status: 404 });
  });

  it('同一活动已参与返回 409', async () => {
    const { prisma, orders, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponMember.findFirst.mockResolvedValue({ id: 5 });

    await expect(
      service.createGroup(1, 1, 'key-grp-0001'),
    ).rejects.toMatchObject({ status: 409 });
    expect(orders.createOrderWithQuote).not.toHaveBeenCalled();
  });

  it('并发唯一冲突（P2002）映射为 409', async () => {
    const { prisma, orders, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponMember.findFirst.mockResolvedValue(null);
    orders.createOrderWithQuote.mockResolvedValue(ORDER);
    prisma.grouponGroup.create.mockResolvedValue(GROUP);
    prisma.grouponMember.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.createGroup(1, 1, 'key-grp-0005'),
    ).rejects.toMatchObject({ bizCode: 5001, status: 409 });
  });
});

describe('GrouponUserService.joinGroup', () => {
  it('参团成功：仅差一人团可加入', async () => {
    const { prisma, orders, service } = setup();
    prisma.grouponGroup.findUnique.mockResolvedValue({
      ...GROUP,
      memberCount: 1,
    });
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponMember.findFirst.mockResolvedValue(null);
    orders.createOrderWithQuote.mockResolvedValue(ORDER);
    prisma.grouponMember.create.mockResolvedValue({});
    prisma.order.update.mockResolvedValue({ ...ORDER, activityId: 20 });

    const result = await service.joinGroup(1, 1, 20, 'key-grp-0002');

    expect(result.group.id).toBe(20);
    expect(prisma.grouponMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ groupId: 20, userId: 1, orderId: 10 }),
    });
  });

  it('已成团的团拒绝加入（5001）', async () => {
    const { prisma, service } = setup();
    prisma.grouponGroup.findUnique.mockResolvedValue({
      ...GROUP,
      status: 'success',
      memberCount: 2,
    });

    await expect(
      service.joinGroup(2, 1, 20, 'key-grp-0003'),
    ).rejects.toMatchObject({ bizCode: 5001, status: 422 });
  });

  it('团组不存在或不属于该活动返回 404', async () => {
    const { prisma, service } = setup();
    prisma.grouponGroup.findUnique.mockResolvedValue(null);
    await expect(
      service.joinGroup(1, 1, 20, 'key-grp-0002'),
    ).rejects.toMatchObject({ bizCode: 1002, status: 404 });

    prisma.grouponGroup.findUnique.mockResolvedValue({
      ...GROUP,
      activityId: 2,
    });
    await expect(
      service.joinGroup(1, 1, 20, 'key-grp-0002'),
    ).rejects.toMatchObject({ bizCode: 1002, status: 404 });
  });

  it('已满团拒绝加入（5001）', async () => {
    const { prisma, service } = setup();
    prisma.grouponGroup.findUnique.mockResolvedValue({
      ...GROUP,
      memberCount: 2,
    });
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponMember.findFirst.mockResolvedValue(null);

    await expect(
      service.joinGroup(2, 1, 20, 'key-grp-0003'),
    ).rejects.toMatchObject({ bizCode: 5001, status: 422 });
  });

  it('同一活动一人一次：重复参与返回 409', async () => {
    const { prisma, service } = setup();
    prisma.grouponGroup.findUnique.mockResolvedValue(GROUP);
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponMember.findFirst.mockResolvedValue({ id: 3 });

    await expect(
      service.joinGroup(1, 1, 20, 'key-grp-0002'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('并发唯一冲突（P2002）映射为 409', async () => {
    const { prisma, orders, service } = setup();
    prisma.grouponGroup.findUnique.mockResolvedValue(GROUP);
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponMember.findFirst.mockResolvedValue(null);
    orders.createOrderWithQuote.mockResolvedValue(ORDER);
    prisma.grouponMember.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.joinGroup(2, 1, 20, 'key-grp-0004'),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('GrouponUserService 幂等', () => {
  it('开团/参团幂等键重放返回首次结果', async () => {
    const { prisma, orders, idempotency, service } = setup();
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
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponMember.findFirst.mockResolvedValue(null);
    orders.createOrderWithQuote.mockResolvedValue(ORDER);
    prisma.grouponGroup.create.mockResolvedValue(GROUP);
    prisma.grouponMember.create.mockResolvedValue({});
    prisma.order.update.mockResolvedValue({ ...ORDER, activityId: 20 });

    const first = await service.createGroup(1, 1, 'key-grp-0001');
    const second = await service.createGroup(1, 1, 'key-grp-0001');

    expect(second.group.id).toBe(first.group.id);
    expect(orders.createOrderWithQuote).toHaveBeenCalledTimes(1);
    expect(prisma.grouponGroup.create).toHaveBeenCalledTimes(1);
  });
});

describe('GrouponUserService 查询', () => {
  it('活动列表仅查询进行中且未结束的活动，并补充封面与原价', async () => {
    const { prisma, storage, service } = setup();
    prisma.grouponActivity.findMany.mockResolvedValue([
      {
        ...ACTIVITY,
        course: {
          name: 'TypeScript 系统入门',
          coverUrl: 'image/2026/01/01/cover.png',
          originalCents: 19900,
        },
      },
    ]);
    prisma.grouponActivity.count.mockResolvedValue(1);
    storage.resolveUrl.mockResolvedValue('https://cdn.example.com/cover.png');

    const page = await service.listActivities({ page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      courseCoverUrl: 'https://cdn.example.com/cover.png',
      courseOriginalCents: 19900,
    });
    expect(prisma.grouponActivity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'ongoing', endAt: { gt: expect.any(Date) } },
      }),
    );
  });

  it('活动详情不存在返回 404；存在时附带待成团团组', async () => {
    const { prisma, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue(null);
    await expect(service.getActivity(1)).rejects.toMatchObject({
      bizCode: 1002,
      status: 404,
    });

    prisma.grouponActivity.findUnique.mockResolvedValue({
      ...ACTIVITY,
      course: { name: 'TypeScript 系统入门' },
    });
    prisma.grouponGroup.findMany.mockResolvedValue([
      { ...GROUP, members: [{ user: { nickname: '团长甲' } }] },
    ]);
    const detail = await service.getActivity(1);
    expect(detail.groups).toHaveLength(1);
    expect(detail.groups[0]).toMatchObject({
      id: 20,
      targetSize: 2,
      leaderNickname: '团长甲',
    });
  });

  it('我的拼团返回活动/团组/订单', async () => {
    const { prisma, service } = setup();
    prisma.grouponMember.findMany.mockResolvedValue([
      {
        joinedAt: new Date(),
        group: {
          ...GROUP,
          activity: {
            ...ACTIVITY,
            course: { name: 'TypeScript 系统入门' },
          },
        },
        order: {
          ...ORDER,
          course: { name: 'TypeScript 系统入门' },
        },
      },
    ]);
    prisma.grouponMember.count.mockResolvedValue(1);

    const page = await service.listMine(1, { page: 1, pageSize: 20 });

    expect(page.items[0]).toMatchObject({
      status: 'pending',
      group: { id: 20 },
      order: { id: 10 },
      activity: { id: 1 },
    });
  });
});

describe('GrouponUserService.failExpiredGroups', () => {
  it('到期未满团：团失败、订单退款、券恢复、支付台账翻转', async () => {
    const { prisma, gateway, service } = setup();
    const now = new Date();
    prisma.grouponGroup.findMany.mockResolvedValue([{ id: 20 }]);
    prisma.grouponGroup.updateMany.mockResolvedValue({ count: 1 });
    prisma.grouponMember.findMany.mockResolvedValue([
      {
        orderId: 10,
        order: {
          ...ORDER,
          status: 'paid',
          couponClaimId: 5,
        },
      },
    ]);
    prisma.payment.findUnique.mockResolvedValue({
      orderId: 10,
      status: 'success',
    });
    prisma.payment.update.mockResolvedValue({});
    prisma.order.update.mockResolvedValue({});
    prisma.couponClaim.update.mockResolvedValue({});

    const n = await service.failExpiredGroups(now);

    expect(n).toBe(1);
    expect(prisma.grouponGroup.updateMany).toHaveBeenCalledWith({
      where: { id: 20, status: 'pending' },
      data: { status: 'failed' },
    });
    expect(gateway.refund).toHaveBeenCalled();
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { orderId: 10 },
      data: { status: 'refunded', refundedAt: now },
    });
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        status: 'refunded',
        purchaseKey: null,
        flashPurchaseKey: null,
      },
    });
    expect(prisma.couponClaim.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { status: 'restored' },
    });
  });

  it('无到期团返回 0', async () => {
    const { prisma, service } = setup();
    prisma.grouponGroup.findMany.mockResolvedValue([]);

    await expect(service.failExpiredGroups(new Date())).resolves.toBe(0);
  });

  it('已被处理（状态非 pending）的团跳过，保持幂等', async () => {
    const { prisma, service } = setup();
    prisma.grouponGroup.findMany.mockResolvedValue([{ id: 20 }]);
    prisma.grouponGroup.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.failExpiredGroups(new Date())).resolves.toBe(0);
    expect(prisma.grouponMember.findMany).not.toHaveBeenCalled();
  });
});
