import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { RedisService } from './redis.service';

// 请求限流服务：基于 Redis 实现滑动窗口限流
@Injectable()
export class RateLimitService {
  // 构造函数：注入 Redis 服务
  constructor(private readonly redis: RedisService) {}

  // 检查限流：验证请求是否超过限流阈值
  async check(key: string, points: number, windowSec: number): Promise<void> {
    // 递增计数器
    const count = await this.redis.incr(key);
    // 如果是第一次计数，设置过期时间
    if (count === 1) await this.redis.expire(key, windowSec);
    // 如果超过限流阈值，抛出限流异常
    if (count > points) {
      throw new BizException(
        ErrorCode.RATE_LIMITED,
        '请求过于频繁，请稍后再试',
        429,
      );
    }
  }

  // 记录一次失败尝试：多个维度同时计数，任一维度超限即抛 429
  async penalize(
    keys: string[],
    points: number,
    windowSec: number,
  ): Promise<void> {
    // 是否有维度已超限
    let exceeded = false;
    // 逐个维度累加失败次数
    for (const key of keys) {
      // 递增计数器
      const count = await this.redis.incr(key);
      // 首次计数时开启窗口
      if (count === 1) await this.redis.expire(key, windowSec);
      // 超过阈值则记录（继续累加其余维度，保证计数一致）
      if (count > points) exceeded = true;
    }
    // 任一维度超限即拒绝
    if (exceeded) {
      throw new BizException(
        ErrorCode.RATE_LIMITED,
        '请求过于频繁，请稍后再试',
        429,
      );
    }
  }

  // 清除计数：登录成功后重置失败次数
  async clear(keys: string[]): Promise<void> {
    for (const key of keys) await this.redis.del(key);
  }
}
