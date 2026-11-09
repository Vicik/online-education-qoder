import { NormalPricingStrategy } from './normal-pricing.strategy';
import { PricingService } from './pricing.service';

// 一天毫秒数：用于构造券有效期边界
const DAY_MS = 24 * 60 * 60 * 1000;
// 已生效（昨天）
const PAST = new Date(Date.now() - DAY_MS);
// 未失效（明天）
const FUTURE = new Date(Date.now() + DAY_MS);

// 已发布课程（原价 199 元、售价 99 元）
const PUBLISHED_COURSE = {
  id: 1,
  originalCents: 19900,
  saleCents: 9900,
  status: 'published',
};

// 构造一张可用的券领取记录（可按需覆盖领取记录或模板字段）
function usableClaim(overrides: Record<string, unknown> = {}) {
  // 拆出模板覆盖字段，其余字段覆盖领取记录本身
  const { template, ...claimOverrides } = overrides;
  return {
    id: 9,
    userId: 1,
    status: 'unused',
    template: {
      discountCents: 2000,
      status: 'enabled',
      startAt: PAST,
      endAt: FUTURE,
      courses: [{ courseId: 1 }],
      ...(template as Record<string, unknown> | undefined),
    },
    ...claimOverrides,
  };
}

// 构造测试依赖：Prisma mock + 普通策略 + 计价服务
function setup() {
  const prisma = {
    course: { findUnique: jest.fn() },
    couponClaim: { findUnique: jest.fn() },
  };
  const strategy = new NormalPricingStrategy(prisma as never);
  const service = new PricingService(prisma as never, [strategy]);
  return { prisma, service, strategy };
}

describe('NormalPricingStrategy', () => {
  it('返回课程售价与 normal 活动类型', async () => {
    const { prisma, strategy } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_COURSE);

    await expect(
      strategy.quote({ courseId: 1, activityId: null }),
    ).resolves.toEqual({
      priceCents: 9900,
      activityType: 'normal',
      activityId: null,
    });
  });

  it('课程不存在抛 404（code=3001）', async () => {
    const { prisma, strategy } = setup();
    prisma.course.findUnique.mockResolvedValue(null);

    await expect(
      strategy.quote({ courseId: 999, activityId: null }),
    ).rejects.toMatchObject({ bizCode: 3001, status: 404 });
  });

  it('课程未发布抛 422（code=1001）', async () => {
    const { prisma, strategy } = setup();
    prisma.course.findUnique.mockResolvedValue({
      ...PUBLISHED_COURSE,
      status: 'unpublished',
    });

    await expect(
      strategy.quote({ courseId: 1, activityId: null }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
  });
});

describe('PricingService.resolve', () => {
  it('按活动类型返回已注册策略', () => {
    const { service, strategy } = setup();

    expect(service.resolve('normal')).toBe(strategy);
  });

  it('未知活动类型抛 400（code=1001）', () => {
    const { service } = setup();

    expect(() => service.resolve('unknown' as never)).toThrow(
      expect.objectContaining({ bizCode: 1001, status: 400 }),
    );
  });
});

describe('PricingService.preview', () => {
  it('不选券：discount=0，实付等于当前价', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_COURSE);

    const data = await service.preview(1, 1, {});

    expect(data).toEqual({
      courseId: 1,
      activityType: 'normal',
      activityId: null,
      originalCents: 19900,
      currentCents: 9900,
      discountCents: 0,
      paidCents: 9900,
      couponClaimId: null,
    });
    expect(prisma.couponClaim.findUnique).not.toHaveBeenCalled();
  });

  it('券可用：originalCents 取课程原价，实付 = 当前价 − 券额', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_COURSE);
    prisma.couponClaim.findUnique.mockResolvedValue(usableClaim());

    const data = await service.preview(1, 1, { couponId: 9 });

    expect(data).toMatchObject({
      originalCents: 19900,
      currentCents: 9900,
      discountCents: 2000,
      paidCents: 7900,
      couponClaimId: 9,
    });
    // 券校验需联查模板与适用课程
    expect(prisma.couponClaim.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9 },
        include: {
          template: { include: { courses: true } },
        },
      }),
    );
  });

  it('券额大于当前价时实付为 0（不出现负数）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_COURSE);
    prisma.couponClaim.findUnique.mockResolvedValue(
      usableClaim({ template: { discountCents: 12000 } }),
    );

    const data = await service.preview(1, 1, { couponId: 9 });

    expect(data.paidCents).toBe(0);
    expect(data.discountCents).toBe(12000);
  });

  it('券不存在抛 422（code=4002）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_COURSE);
    prisma.couponClaim.findUnique.mockResolvedValue(null);

    await expect(service.preview(1, 1, { couponId: 9 })).rejects.toMatchObject({
      bizCode: 4002,
      status: 422,
    });
  });

  it('他人券抛 422（code=4002）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_COURSE);
    prisma.couponClaim.findUnique.mockResolvedValue(usableClaim({ userId: 2 }));

    await expect(service.preview(1, 1, { couponId: 9 })).rejects.toMatchObject({
      bizCode: 4002,
      status: 422,
    });
  });

  it('已使用券抛 422（code=4002）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_COURSE);
    prisma.couponClaim.findUnique.mockResolvedValue(
      usableClaim({ status: 'used' }),
    );

    await expect(service.preview(1, 1, { couponId: 9 })).rejects.toMatchObject({
      bizCode: 4002,
      status: 422,
    });
  });

  it('模板停用抛 422（code=4002）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_COURSE);
    prisma.couponClaim.findUnique.mockResolvedValue(
      usableClaim({ template: { status: 'disabled' } }),
    );

    await expect(service.preview(1, 1, { couponId: 9 })).rejects.toMatchObject({
      bizCode: 4002,
      status: 422,
    });
  });

  it('券不适用当前课程抛 422（code=4002）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_COURSE);
    prisma.couponClaim.findUnique.mockResolvedValue(
      usableClaim({ template: { courses: [{ courseId: 2 }] } }),
    );

    await expect(service.preview(1, 1, { couponId: 9 })).rejects.toMatchObject({
      bizCode: 4002,
      status: 422,
    });
  });

  it('券不在有效期抛 422（code=4002）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_COURSE);
    prisma.couponClaim.findUnique.mockResolvedValue(
      usableClaim({ template: { endAt: PAST } }),
    );

    await expect(service.preview(1, 1, { couponId: 9 })).rejects.toMatchObject({
      bizCode: 4002,
      status: 422,
    });
  });

  it('课程不存在抛 404（code=3001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(null);

    await expect(service.preview(1, 999, {})).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });
});
