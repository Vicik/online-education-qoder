import { FakeRedis } from '../../test/utils/fake-redis';
import { LockService } from './lock.service';
import { RedisService } from './redis.service';

function setup() {
  const redis = new FakeRedis();
  return { redis, lock: new LockService(redis as unknown as RedisService) };
}

describe('LockService', () => {
  it('抢到锁返回释放函数，重复抢锁返回 null', async () => {
    const { lock } = setup();
    const release = await lock.acquire('k', 1000);

    expect(typeof release).toBe('function');
    expect(await lock.acquire('k', 1000)).toBeNull();
  });

  it('释放后可再次抢到', async () => {
    const { lock } = setup();
    const release = await lock.acquire('k', 1000);
    await release!();

    expect(await lock.acquire('k', 1000)).not.toBeNull();
  });

  it('不同 key 互不影响', async () => {
    const { lock } = setup();
    await lock.acquire('a', 1000);
    expect(await lock.acquire('b', 1000)).not.toBeNull();
  });

  it('ttlMs 向上取整为秒并设置过期', async () => {
    const { redis, lock } = setup();
    await lock.acquire('k', 1500);
    expect(redis.expiries.get('k')).toBe(2);
  });

  it('亚毫秒级 ttl 也至少设 1 秒，避免永不过期', async () => {
    const { redis, lock } = setup();
    await lock.acquire('k', 1);
    expect(redis.expiries.get('k')).toBe(1);
  });

  it('锁被他人持有时释放不会误删', async () => {
    const { redis, lock } = setup();
    const release = await lock.acquire('k', 1000);
    // 模拟锁到期后被另一个持有者抢占
    redis.store.set('k', 'other-holder');

    await release!();
    expect(redis.store.get('k')).toBe('other-holder');
  });

  it('重复释放是幂等的', async () => {
    const { lock } = setup();
    const release = await lock.acquire('k', 1000);
    await release!();
    await release!();
    expect(await lock.acquire('k', 1000)).not.toBeNull();
  });
});
