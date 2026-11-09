import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from './redis.service';

// 分布式锁服务：基于 Redis 实现简单的分布式锁
@Injectable()
export class LockService {
  // 构造函数：注入 Redis 服务
  constructor(private readonly redis: RedisService) {}

  // 获取锁：尝试获取指定键的分布式锁
  async acquire(
    key: string, // 锁的键名
    ttlMs: number, // 锁的过期时间（毫秒）
  ): Promise<(() => Promise<void>) | null> {
    // 生成唯一的锁令牌
    const token = randomUUID();
    // 将毫秒转换为秒，至少 1 秒
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    // 尝试设置锁（NX 表示只在键不存在时设置）
    const acquired = await this.redis.setNxEx(key, token, ttlSec);
    // 如果获取锁失败，返回 null
    if (!acquired) return null;
    // 返回释放锁的函数
    return () => this.redis.delIfValue(key, token);
  }
}
