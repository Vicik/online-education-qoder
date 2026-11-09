import type { GrouponUserService } from '../promotion/groupon/groupon.user.service';
import { GrouponExpiryJob } from './groupon-expiry.job';

describe('GrouponExpiryJob', () => {
  it('调用 failExpiredGroups(now) 并返回处理数', async () => {
    const groupons = {
      failExpiredGroups: jest.fn().mockResolvedValue(3),
    };
    const job = new GrouponExpiryJob(groupons as unknown as GrouponUserService);
    const now = new Date();

    await expect(job.run(now)).resolves.toBe(3);
    expect(groupons.failExpiredGroups).toHaveBeenCalledWith(now);
  });
});
