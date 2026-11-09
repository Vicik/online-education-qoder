import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { FakeRedis } from '../../../test/utils/fake-redis';
import { FlashStockService } from './flash-stock.service';

function setup() {
  const redis = new FakeRedis();
  const prisma = {
    flashSaleActivity: { findUnique: jest.fn() },
  };
  const service = new FlashStockService(
    redis as unknown as RedisService,
    prisma as unknown as PrismaService,
  );
  return { redis, prisma, service };
}

describe('FlashStockService', () => {
  it('预热后可预扣；耗尽返回 false 且回补后保持 0', async () => {
    const { service } = setup();

    await service.warmup(1, 2);

    await expect(service.preDeduct(1)).resolves.toBe(true);
    await expect(service.preDeduct(1)).resolves.toBe(true);
    await expect(service.preDeduct(1)).resolves.toBe(false);
    await expect(service.remaining(1)).resolves.toBe(0);
  });

  it('restore 回补 +1', async () => {
    const { service } = setup();
    await service.warmup(1, 1);
    await service.preDeduct(1);

    await service.restore(1);

    await expect(service.remaining(1)).resolves.toBe(1);
  });

  it('remaining 缺失时回源 DB 并回填 Redis', async () => {
    const { redis, prisma, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue({
      id: 1,
      stock: 5,
      sold: 2,
    });

    await expect(service.remaining(1)).resolves.toBe(3);
    expect(prisma.flashSaleActivity.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
    });
    await expect(redis.get('flash:stock:1')).resolves.toBe('3');

    await expect(service.remaining(1)).resolves.toBe(3);
    expect(prisma.flashSaleActivity.findUnique).toHaveBeenCalledTimes(1);
  });

  it('remaining 活动不存在返回 404', async () => {
    const { prisma, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(null);

    await expect(service.remaining(9)).rejects.toMatchObject({
      bizCode: 1002,
      status: 404,
    });
  });
});
