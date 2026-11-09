import type { PrismaService } from '../prisma/prisma.service';
import { CouponExpiryJob } from './coupon-expiry.job';

describe('CouponExpiryJob', () => {
  it('unused/restored 且模板 endAt<now → expired（幂等：只处理未失效）', async () => {
    const prisma = {
      couponClaim: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const job = new CouponExpiryJob(prisma as unknown as PrismaService);
    const now = new Date();

    await expect(job.run(now)).resolves.toBe(2);
    expect(prisma.couponClaim.updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['unused', 'restored'] },
        template: { endAt: { lt: now } },
      },
      data: { status: 'expired' },
    });
  });
});
