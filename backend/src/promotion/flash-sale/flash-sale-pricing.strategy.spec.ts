import { PrismaService } from '../../prisma/prisma.service';
import { FlashSalePricingStrategy } from './flash-sale-pricing.strategy';

const HOUR_MS = 60 * 60 * 1000;

const ACTIVITY = {
  id: 5,
  courseId: 1,
  name: '限时秒杀',
  priceCents: 5900,
  stock: 10,
  sold: 2,
  startAt: new Date(Date.now() - HOUR_MS),
  endAt: new Date(Date.now() + HOUR_MS),
  status: 'ongoing',
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup() {
  const prisma = {
    flashSaleActivity: { findUnique: jest.fn() },
  };
  const strategy = new FlashSalePricingStrategy(
    prisma as unknown as PrismaService,
  );
  return { prisma, strategy };
}

describe('FlashSalePricingStrategy', () => {
  it('进行中活动返回秒杀价与活动 id', async () => {
    const { prisma, strategy } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);

    await expect(
      strategy.quote({ courseId: 1, activityId: 5 }),
    ).resolves.toEqual({
      priceCents: 5900,
      activityType: 'flash_sale',
      activityId: 5,
    });
  });

  it('缺少活动 id 或活动不属于该课程返回 5002', async () => {
    const { prisma, strategy } = setup();

    await expect(
      strategy.quote({ courseId: 1, activityId: null }),
    ).rejects.toMatchObject({ bizCode: 5002, status: 422 });

    prisma.flashSaleActivity.findUnique.mockResolvedValue({
      ...ACTIVITY,
      courseId: 2,
    });
    await expect(
      strategy.quote({ courseId: 1, activityId: 5 }),
    ).rejects.toMatchObject({ bizCode: 5002, status: 422 });
  });

  it('未开始/已结束/非进行中返回 5002', async () => {
    for (const patch of [
      { status: 'not_started' },
      { status: 'ended' },
      { status: 'ongoing', endAt: new Date(Date.now() - HOUR_MS) },
      { status: 'ongoing', startAt: new Date(Date.now() + HOUR_MS) },
    ]) {
      const { prisma, strategy } = setup();
      prisma.flashSaleActivity.findUnique.mockResolvedValue({
        ...ACTIVITY,
        ...patch,
      });

      await expect(
        strategy.quote({ courseId: 1, activityId: 5 }),
      ).rejects.toMatchObject({ bizCode: 5002, status: 422 });
    }
  });

  it('数据库已售罄返回 4001', async () => {
    const { prisma, strategy } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue({
      ...ACTIVITY,
      sold: 10,
    });

    await expect(
      strategy.quote({ courseId: 1, activityId: 5 }),
    ).rejects.toMatchObject({ bizCode: 4001, status: 422 });
  });
});
