import { FakeRedis } from '../../test/utils/fake-redis';
import { BizException } from '../common/exceptions/biz.exception';
import { RateLimitService } from './rate-limit.service';
import { RedisService } from './redis.service';

function setup() {
  const redis = new FakeRedis();
  return {
    redis,
    limiter: new RateLimitService(redis as unknown as RedisService),
  };
}

describe('RateLimitService', () => {
  it('窗口内第 6 次抛 429', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i += 1) await limiter.check('login:ip:1', 5, 60);

    await expect(limiter.check('login:ip:1', 5, 60)).rejects.toBeInstanceOf(
      BizException,
    );
    await expect(limiter.check('login:ip:1', 5, 60)).rejects.toMatchObject({
      bizCode: 1005,
    });
  });

  it('超限异常的 HTTP 状态是 429', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i += 1) await limiter.check('k', 5, 60);

    const error = await limiter.check('k', 5, 60).catch((e: BizException) => e);
    expect(error).toBeInstanceOf(BizException);
    expect((error as BizException).getStatus()).toBe(429);
  });

  it('首次计数时设置窗口过期', async () => {
    const { redis, limiter } = setup();
    await limiter.check('k', 5, 60);
    expect(redis.expiries.get('k')).toBe(60);
  });

  it('后续计数不刷新窗口，避免滑动续期', async () => {
    const { redis, limiter } = setup();
    await limiter.check('k', 5, 60);
    redis.expiries.delete('k');
    await limiter.check('k', 5, 60);
    expect(redis.expiries.has('k')).toBe(false);
  });

  it('不同 key 各自计数', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i += 1) await limiter.check('a', 5, 60);
    await expect(limiter.check('b', 5, 60)).resolves.toBeUndefined();
  });

  it('恰好用满配额时每次都通过', async () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i += 1) {
      await expect(limiter.check('k', 5, 60)).resolves.toBeUndefined();
    }
  });

  describe('penalize / clear（登录失败计数）', () => {
    it('第 6 次失败才抛 429，前 5 次通过', async () => {
      const { limiter } = setup();
      for (let i = 0; i < 5; i += 1) {
        await expect(
          limiter.penalize(['login:email:a@b.com'], 5, 60),
        ).resolves.toBeUndefined();
      }
      await expect(
        limiter.penalize(['login:email:a@b.com'], 5, 60),
      ).rejects.toMatchObject({ bizCode: 1005 });
    });

    it('多维度同时计数：任一维度超限即抛 429', async () => {
      const { redis, limiter } = setup();
      // 先把邮箱维度打到上限
      for (let i = 0; i < 5; i += 1) {
        await limiter.penalize(['login:email:a@b.com'], 5, 60);
      }

      await expect(
        limiter.penalize(['login:ip:1', 'login:email:a@b.com'], 5, 60),
      ).rejects.toMatchObject({ bizCode: 1005 });
      // 两个维度都完成本轮计数
      expect(redis.store.get('login:ip:1')).toBe('1');
      expect(redis.store.get('login:email:a@b.com')).toBe('6');
    });

    it('clear 后计数归零，可重新累计', async () => {
      const { limiter } = setup();
      for (let i = 0; i < 5; i += 1) {
        await limiter.penalize(['k'], 5, 60);
      }
      await limiter.clear(['k']);

      for (let i = 0; i < 5; i += 1) {
        await expect(limiter.penalize(['k'], 5, 60)).resolves.toBeUndefined();
      }
    });
  });
});
