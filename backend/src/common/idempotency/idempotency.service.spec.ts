import { BizException } from '../exceptions/biz.exception';
import { IdempotencyService } from './idempotency.service';
import { FakeRedis } from '../../../test/utils/fake-redis';
import { RedisService } from '../../redis/redis.service';

interface Row {
  response: unknown;
}

class FakePrisma {
  readonly rows = new Map<string, Row>();
  createCalls = 0;
  findCalls = 0;
  conflictOnCreate = false;
  private readonly unique = (userId: number, key: string, endpoint: string) =>
    `${userId}:${key}:${endpoint}`;

  readonly idempotencyKey = {
    findUnique: async (args: {
      where: {
        userId_key_endpoint: { userId: number; key: string; endpoint: string };
      };
    }): Promise<Row | null> => {
      this.findCalls += 1;
      const { userId, key, endpoint } = args.where.userId_key_endpoint;
      return this.rows.get(this.unique(userId, key, endpoint)) ?? null;
    },
    create: async (args: {
      data: {
        userId: number;
        key: string;
        endpoint: string;
        response: unknown;
      };
    }): Promise<Row> => {
      this.createCalls += 1;
      const { userId, key, endpoint, response } = args.data;
      const id = this.unique(userId, key, endpoint);
      if (this.conflictOnCreate || this.rows.has(id)) {
        const error = new Error('Unique constraint failed') as Error & {
          code: string;
        };
        error.code = 'P2002';
        throw error;
      }
      const row = { response };
      this.rows.set(id, row);
      return row;
    },
  };

  seed(userId: number, key: string, endpoint: string, response: unknown) {
    this.rows.set(this.unique(userId, key, endpoint), { response });
  }
}

function setup() {
  const prisma = new FakePrisma();
  const redis = new FakeRedis();
  const service = new IdempotencyService(
    prisma as never,
    redis as unknown as RedisService,
  );
  return { prisma, redis, service };
}

describe('IdempotencyService', () => {
  it('同键重放返回首次结果且 fn 只执行一次', async () => {
    const { service } = setup();
    const fn = jest.fn().mockResolvedValue({ id: 1 });

    await service.run(1, 'key-123456', 'POST /orders', fn);
    const again = await service.run(1, 'key-123456', 'POST /orders', fn);

    expect(again).toEqual({ id: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('首次成功后写入 Redis 缓存并设 24h TTL', async () => {
    const { redis, service } = setup();
    await service.run(1, 'key-123456', 'POST /orders', async () => ({ id: 1 }));

    const cacheKey = 'idem:1:POST /orders:key-123456';
    expect(JSON.parse((await redis.get(cacheKey))!)).toEqual({ id: 1 });
    expect(redis.expiries.get(cacheKey)).toBe(86400);
  });

  it('Redis 未命中但库里已有记录时返回库中结果且不执行 fn', async () => {
    const { prisma, service } = setup();
    prisma.seed(1, 'key-123456', 'POST /orders', { id: 99 });
    const fn = jest.fn().mockResolvedValue({ id: 1 });

    await expect(
      service.run(1, 'key-123456', 'POST /orders', fn),
    ).resolves.toEqual({
      id: 99,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('不同 userId / endpoint / key 相互隔离', async () => {
    const { service } = setup();
    const fn = jest.fn().mockResolvedValue({ id: 1 });

    await service.run(1, 'key-123456', 'POST /orders', fn);
    await service.run(2, 'key-123456', 'POST /orders', fn);
    await service.run(1, 'key-123456', 'POST /coupons', fn);
    await service.run(1, 'key-654321', 'POST /orders', fn);

    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('fn 抛错时不落库也不缓存，下次可重试', async () => {
    const { prisma, redis, service } = setup();
    const fn = jest
      .fn()
      .mockRejectedValue(new BizException(4001, '库存不足', 422));

    await expect(
      service.run(1, 'key-123456', 'POST /orders', fn),
    ).rejects.toMatchObject({
      bizCode: 4001,
    });
    expect(prisma.rows.size).toBe(0);
    expect(redis.store.size).toBe(0);

    await expect(
      service.run(1, 'key-123456', 'POST /orders', async () => ({ id: 2 })),
    ).resolves.toEqual({ id: 2 });
  });

  it('并发同键唯一约束冲突时重查返回首次结果', async () => {
    const { prisma, service } = setup();
    prisma.seed(1, 'key-123456', 'POST /orders', { id: 7 });
    prisma.conflictOnCreate = true;
    // 让首次 findUnique 落空，模拟两个请求同时进入
    const original = prisma.idempotencyKey.findUnique;
    let firstCall = true;
    prisma.idempotencyKey.findUnique = async (args) => {
      if (firstCall) {
        firstCall = false;
        return null;
      }
      return original(args);
    };

    const fn = jest.fn().mockResolvedValue({ id: 8 });
    await expect(
      service.run(1, 'key-123456', 'POST /orders', fn),
    ).resolves.toEqual({
      id: 7,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('唯一冲突后重查始终为空则抛 4004/409', async () => {
    const { prisma, service } = setup();
    prisma.conflictOnCreate = true;
    const fn = jest.fn().mockResolvedValue({ id: 8 });

    await expect(
      service.run(1, 'key-123456', 'POST /orders', fn),
    ).rejects.toMatchObject({
      bizCode: 4004,
    });
  }, 15000);

  it('非唯一约束的落库错误原样抛出', async () => {
    const { prisma, service } = setup();
    prisma.idempotencyKey.create = async () => {
      throw new Error('db down');
    };

    await expect(
      service.run(1, 'key-123456', 'POST /orders', async () => ({ id: 1 })),
    ).rejects.toThrow('db down');
  });
});
