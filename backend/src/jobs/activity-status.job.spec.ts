import type { PrismaService } from '../prisma/prisma.service';
import { ActivityStatusJob } from './activity-status.job';

describe('ActivityStatusJob', () => {
  it('按时间推进 not_started→ongoing→ended（拼团与秒杀）', async () => {
    const grouponActivity = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const flashSaleActivity = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = { grouponActivity, flashSaleActivity };
    const job = new ActivityStatusJob(prisma as unknown as PrismaService);
    const now = new Date();

    await expect(job.run(now)).resolves.toBe(4);

    expect(grouponActivity.updateMany).toHaveBeenCalledWith({
      where: { status: 'not_started', startAt: { lte: now } },
      data: { status: 'ongoing' },
    });
    expect(grouponActivity.updateMany).toHaveBeenCalledWith({
      where: { status: 'ongoing', endAt: { lt: now } },
      data: { status: 'ended' },
    });
    expect(flashSaleActivity.updateMany).toHaveBeenCalledWith({
      where: { status: 'not_started', startAt: { lte: now } },
      data: { status: 'ongoing' },
    });
    expect(flashSaleActivity.updateMany).toHaveBeenCalledWith({
      where: { status: 'ongoing', endAt: { lt: now } },
      data: { status: 'ended' },
    });
  });

  it('先开播再结束：错过开始时间的活动同轮进入 ended', async () => {
    const grouponActivity = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const flashSaleActivity = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma = { grouponActivity, flashSaleActivity };
    const job = new ActivityStatusJob(prisma as unknown as PrismaService);

    await job.run(new Date());

    const startOrder = grouponActivity.updateMany.mock.invocationCallOrder[0];
    const endOrder = grouponActivity.updateMany.mock.invocationCallOrder[1];
    expect(startOrder).toBeLessThan(endOrder);
  });
});
