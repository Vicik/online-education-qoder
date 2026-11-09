/** 单元测试用的内存 Redis 替身；不模拟 TTL 到期，只记录 expire 调用。 */
export class FakeRedis {
  readonly store = new Map<string, string>();
  readonly expiries = new Map<string, number>();
  private readonly sets = new Map<string, Set<string>>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string, ttlSec?: number): Promise<void> {
    this.store.set(key, String(value));
    if (ttlSec !== undefined) this.expiries.set(key, ttlSec);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    this.sets.delete(key);
    return Promise.resolve();
  }

  incr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? 0) + 1;
    this.store.set(key, String(next));
    return Promise.resolve(next);
  }

  decr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? 0) - 1;
    this.store.set(key, String(next));
    return Promise.resolve(next);
  }

  expire(key: string, ttlSec: number): Promise<void> {
    this.expiries.set(key, ttlSec);
    return Promise.resolve();
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    const before = set.size;
    for (const member of members) set.add(member);
    this.sets.set(key, set);
    return Promise.resolve(set.size - before);
  }

  srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return Promise.resolve(0);
    let removed = 0;
    for (const member of members) if (set.delete(member)) removed += 1;
    return Promise.resolve(removed);
  }

  smembers(key: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }

  setNxEx(key: string, value: string, ttlSec: number): Promise<boolean> {
    if (this.store.has(key)) return Promise.resolve(false);
    this.store.set(key, String(value));
    this.expiries.set(key, ttlSec);
    return Promise.resolve(true);
  }

  delIfValue(key: string, value: string): Promise<void> {
    if (this.store.get(key) === String(value)) this.store.delete(key);
    return Promise.resolve();
  }
}