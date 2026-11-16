import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CouponUserService } from './coupon.user.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST = new Date(Date.now() - DAY_MS);
const FUTURE = new Date(Date.now() + DAY_MS);

const TEMPLATE = {
  id: 1,
  name: '立减券',
  discountCents: 2000,
  startAt: PAST,
  endAt: FUTURE,
  totalQty: 100,
  claimedCount: 50,
  status: 'enabled',
  version: 1,
  courses: [{ courseId: 1, course: { name: 'TypeScript 系统入门' } }],
};

const CLAIM_ROW = {
  id: 11,
  templateId: 1,
  userId: 1,
  status: 'unused',
  claimKey: 'template:1:user:1',
  claimedAt: new Date(),
  usedAt: null,
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  template: TEMPLATE,
};

function setup() {
  const prisma = {
    course: { findFirst: jest.fn() },
    couponTemplateCourse: { findMany: jest.fn() },
    couponTemplate: { findUnique: jest.fn(), updateMany: jest.fn() },
    couponClaim: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
  );
  const idempotency = {
    run: jest.fn(
      (
        _userId: number,
        _key: string,
        _endpoint: string,
        fn: () => Promise<unknown>,
      ) => fn(),
    ),
  };
  const service = new CouponUserService(
    prisma as unknown as PrismaService,
    idempotency as unknown as IdempotencyService,
  );
  return { prisma, idempotency, service };
}

describe('CouponUserService.listForCourse', () => {
  it('返回启用、有效期内且未发完的适用券', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue({ id: 1 });
    prisma.couponTemplateCourse.findMany.mockResolvedValue([
      { template: TEMPLATE },
    ]);

    const list = await service.listForCourse(1);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 1, courseIds: [1] });
    expect(prisma.couponTemplateCourse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          courseId: 1,
          template: {
            status: 'enabled',
            startAt: { lte: expect.any(Date) },
            endAt: { gte: expect.any(Date) },
          },
        },
      }),
    );
  });

  it('总量已发完不返回', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue({ id: 1 });
    prisma.couponTemplateCourse.findMany.mockResolvedValue([
      { template: { ...TEMPLATE, claimedCount: 100 } },
    ]);

    expect(await service.listForCourse(1)).toHaveLength(0);
  });

  it('课程不存在或未发布返回 404', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue(null);

    await expect(service.listForCourse(999)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });
});

describe('CouponUserService.claim', () => {
  it('成功领取写入 claimKey，并返回模板展示字段', async () => {
    const { prisma, idempotency, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue(TEMPLATE);
    prisma.couponClaim.findFirst.mockResolvedValue(null);
    prisma.couponTemplate.updateMany.mockResolvedValue({ count: 1 });
    prisma.couponClaim.create.mockResolvedValue(CLAIM_ROW);

    const claim = await service.claim(1, 1, 'key-abc123');

    expect(claim).toMatchObject({
      id: 11,
      claimKey: 'template:1:user:1',
      templateName: '立减券',
      discountCents: 2000,
      courseIds: [1],
      courseNames: ['TypeScript 系统入门'],
      status: 'unused',
    });
    expect(prisma.couponTemplate.updateMany).toHaveBeenCalledWith({
      where: {
        id: 1,
        status: 'enabled',
        claimedCount: { lt: 100 },
      },
      data: { claimedCount: { increment: 1 } },
    });
    expect(prisma.couponClaim.create).toHaveBeenCalledWith({
      data: {
        templateId: 1,
        userId: 1,
        claimKey: 'template:1:user:1',
      },
    });
    expect(idempotency.run).toHaveBeenCalledWith(
      1,
      'key-abc123',
      'POST /coupons/1/claim',
      expect.any(Function),
    );
  });

  it('同一启用周期已有未失效记录（unused/used/expired）再领返回 409', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue(TEMPLATE);
    prisma.couponClaim.findFirst.mockResolvedValue({ id: 9, status: 'used' });

    await expect(service.claim(1, 1, 'key-abc124')).rejects.toMatchObject({
      bizCode: 1001,
      status: 409,
    });
    expect(prisma.couponTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('模板停用返回 422（code=4002）', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue({
      ...TEMPLATE,
      status: 'disabled',
    });

    await expect(service.claim(1, 1, 'key-abc125')).rejects.toMatchObject({
      bizCode: 4002,
      status: 422,
    });
  });

  it('不在领取有效期返回 422（code=4002）', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue({
      ...TEMPLATE,
      endAt: new Date(Date.now() - DAY_MS),
    });

    await expect(service.claim(1, 1, 'key-abc126')).rejects.toMatchObject({
      bizCode: 4002,
      status: 422,
    });
  });

  it('模板不存在返回 404', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue(null);

    await expect(service.claim(1, 999, 'key-abc127')).rejects.toMatchObject({
      bizCode: 1002,
      status: 404,
    });
  });

  it('超发保护：条件更新计数 0 返回 422（code=4002）', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue(TEMPLATE);
    prisma.couponClaim.findFirst.mockResolvedValue(null);
    prisma.couponTemplate.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.claim(1, 1, 'key-abc128')).rejects.toMatchObject({
      bizCode: 4002,
      status: 422,
    });
    expect(prisma.couponClaim.create).not.toHaveBeenCalled();
  });

  it('claimKey 唯一约束冲突（并发）返回 409', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue(TEMPLATE);
    prisma.couponClaim.findFirst.mockResolvedValue(null);
    prisma.couponTemplate.updateMany.mockResolvedValue({ count: 1 });
    prisma.couponClaim.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.claim(1, 1, 'key-abc129')).rejects.toMatchObject({
      bizCode: 1001,
      status: 409,
    });
  });
});

describe('CouponUserService.listMine', () => {
  it('按状态筛选并映射模板信息', async () => {
    const { prisma, service } = setup();
    prisma.couponClaim.findMany.mockResolvedValue([CLAIM_ROW]);
    prisma.couponClaim.count.mockResolvedValue(1);

    const page = await service.listMine(1, 'unused', {
      page: 1,
      pageSize: 20,
    });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      templateName: '立减券',
      courseIds: [1],
      courseNames: ['TypeScript 系统入门'],
    });
    expect(prisma.couponClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, status: 'unused' } }),
    );
  });

  it('不传状态时返回全部，分页参数兜底', async () => {
    const { prisma, service } = setup();
    prisma.couponClaim.findMany.mockResolvedValue([]);
    prisma.couponClaim.count.mockResolvedValue(0);

    const page = await service.listMine(1);

    expect(page).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(prisma.couponClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1 }, skip: 0, take: 20 }),
    );
  });
});

describe('CouponUserService 事务内核销与恢复', () => {
  it('核销：unused → used 且 usedAt 置位', async () => {
    const { prisma, service } = setup();
    prisma.couponClaim.updateMany.mockResolvedValue({ count: 1 });
    prisma.couponClaim.findUniqueOrThrow.mockResolvedValue({
      ...CLAIM_ROW,
      status: 'used',
      usedAt: new Date(),
    });

    const claim = await service.redeemInTx(
      prisma as unknown as never,
      11,
      1,
      88,
    );

    expect(claim.status).toBe('used');
    expect(prisma.couponClaim.updateMany).toHaveBeenCalledWith({
      where: { id: 11, userId: 1, status: 'unused' },
      data: { status: 'used', usedAt: expect.any(Date) },
    });
  });

  it('核销失败（非本人/非未使用）返回 422（code=4002）', async () => {
    const { prisma, service } = setup();
    prisma.couponClaim.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.redeemInTx(prisma as unknown as never, 11, 1, 88),
    ).rejects.toMatchObject({ bizCode: 4002, status: 422 });
  });

  it('恢复：used → restored', async () => {
    const { prisma, service } = setup();
    prisma.couponClaim.updateMany.mockResolvedValue({ count: 1 });

    await service.restoreInTx(prisma as unknown as never, 11);

    expect(prisma.couponClaim.updateMany).toHaveBeenCalledWith({
      where: { id: 11, status: 'used' },
      data: { status: 'restored' },
    });
  });
});
