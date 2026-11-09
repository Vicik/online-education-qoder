import type { FlashStockService } from '../promotion/flash-sale/flash-stock.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FlashStockWarmupJob } from './flash-stock-warmup.job';

describe('FlashStockWarmupJob', () => {
  it('活动进入 ongoing 时 SET 剩余=stock-sold（幂等）', async () => {
    const prisma = {
      flashSaleActivity: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: 5, stock: 50, sold: 2 }]),
      },
    };
    const stock = { warmup: jest.fn().mockResolvedValue(undefined) };
    const job = new FlashStockWarmupJob(
      prisma as unknown as PrismaService,
      stock as unknown as FlashStockService,
    );
    const now = new Date();

    await expect(job.run(now)).resolves.toBe(1);
    expect(stock.warmup).toHaveBeenCalledWith(5, 48);
    expect(prisma.flashSaleActivity.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'not_started',
        startAt: { lte: now },
        endAt: { gt: now },
      },
      data: { status: 'ongoing' },
    });
  });

  it('重复预热使用相同剩余库存覆盖（幂等）', async () => {
    const prisma = {
      flashSaleActivity: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([{ id: 5, stock: 50, sold: 2 }]),
      },
    };
    const stock = { warmup: jest.fn().mockResolvedValue(undefined) };
    const job = new FlashStockWarmupJob(
      prisma as unknown as PrismaService,
      stock as unknown as FlashStockService,
    );

    await job.run(new Date());
    await job.run(new Date());

    expect(stock.warmup).toHaveBeenNthCalledWith(1, 5, 48);
    expect(stock.warmup).toHaveBeenNthCalledWith(2, 5, 48);
  });
});
