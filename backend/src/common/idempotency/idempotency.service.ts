import { Inject, Injectable } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { ErrorCode } from '../constants/error-codes';
import { BizException } from '../exceptions/biz.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

// 幂等性缓存过期时间（秒）：24 小时
const CACHE_TTL_SEC = 86400;
// 冲突重试次数：当遇到唯一性冲突时最多重试 10 次
const CONFLICT_RETRIES = 10;
// 冲突重试间隔（毫秒）：每次重试间隔 100 毫秒
const CONFLICT_RETRY_MS = 100;

// 幂等性记录行接口：定义数据库中存储的幂等性响应结构
interface IdempotencyRow {
  response: unknown; // 之前请求的响应结果
}

// 幂等性存储接口：声明本服务用到的 Prisma delegate 类型
export interface IdempotencyStore {
  idempotencyKey: {
    // 根据用户 ID、幂等键和接口路径查找唯一记录
    findUnique(args: {
      where: {
        userId_key_endpoint: { userId: number; key: string; endpoint: string };
      };
    }): Promise<IdempotencyRow | null>;
    // 创建新的幂等性记录
    create(args: {
      data: {
        userId: number; // 用户 ID
        key: string; // 幂等键
        endpoint: string; // 接口路径
        response: unknown; // 响应结果
      };
    }): Promise<unknown>;
  };
}

// 判断错误是否为唯一性冲突（P2002 是 Prisma 的唯一约束冲突错误码）
function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

// 幂等性服务：防止重复提交，确保同一请求只处理一次
@Injectable()
export class IdempotencyService {
  // 构造函数：注入 Prisma 服务和 Redis 服务
  constructor(
    @Inject(PrismaService) private readonly prisma: IdempotencyStore, // Prisma 存储服务
    private readonly redis: RedisService, // Redis 缓存服务
  ) {}

  // 执行幂等性操作：确保相同请求只处理一次，返回缓存或数据库中的结果
  async run<T>(
    userId: number, // 用户 ID
    key: string, // 幂等键
    endpoint: string, // 接口路径
    fn: () => Promise<T>, // 实际要执行的业务逻辑
  ): Promise<T> {
    // 构造 Redis 缓存键
    const cacheKey = `idem:${userId}:${endpoint}:${key}`;
    // 构造数据库查询条件
    const where = { userId_key_endpoint: { userId, key, endpoint } };

    // 先尝试从 Redis 缓存获取结果
    const cached = await this.redis.get(cacheKey);
    // 如果缓存命中，直接返回解析后的结果
    if (cached !== null) return JSON.parse(cached) as T;

    // 从数据库查询已有的幂等性记录
    const existing = await this.prisma.idempotencyKey.findUnique({ where });
    // 如果数据库记录存在，缓存并返回
    if (existing) return this.remember(cacheKey, existing.response);

    // 执行实际的业务逻辑
    const result = await fn();

    try {
      // 尝试将结果写入数据库作为幂等性记录
      await this.prisma.idempotencyKey.create({
        data: { userId, key, endpoint, response: result },
      });
    } catch (error) {
      // 如果是唯一性冲突，说明另一个请求已经在处理
      if (!isUniqueConflict(error)) throw error;
      // 等待第一个请求的结果
      return this.awaitFirstResult(cacheKey, where);
    }

    // 将结果缓存到 Redis 并返回
    return this.remember(cacheKey, result);
  }

  // 缓存结果到 Redis：将响应序列化并存储，设置过期时间
  private async remember<T>(cacheKey: string, response: unknown): Promise<T> {
    await this.redis.set(cacheKey, JSON.stringify(response), CACHE_TTL_SEC);
    return response as T;
  }

  // 等待第一个请求的结果：当遇到冲突时轮询数据库直到获取结果
  private async awaitFirstResult<T>(
    cacheKey: string, // Redis 缓存键
    where: {
      userId_key_endpoint: { userId: number; key: string; endpoint: string };
    }, // 数据库查询条件
  ): Promise<T> {
    // 循环重试直到获取到结果或超过最大重试次数
    for (let attempt = 0; attempt < CONFLICT_RETRIES; attempt += 1) {
      // 查询数据库中的幂等性记录
      const row = await this.prisma.idempotencyKey.findUnique({ where });
      // 如果记录存在，缓存并返回结果
      if (row) return this.remember(cacheKey, row.response);
      // 等待一段时间后重试
      await sleep(CONFLICT_RETRY_MS);
    }
    // 超过重试次数，抛出幂等性冲突异常
    throw new BizException(
      ErrorCode.IDEMPOTENCY_CONFLICT,
      '请求正在处理中，请稍后重试',
      409,
    );
  }
}
