import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import { BizException } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

// Redis 库存键前缀：flash:{stock}:{activityId}
export const FLASH_STOCK_KEY_PREFIX = 'flash:stock:';

// 秒杀 Redis 库存封装：预占（DECR）与回补（INCR），Redis 缺失时回源数据库
@Injectable()
export class FlashStockService {
  // 键名常量：供 Worker 与支付失败回补复用
  readonly KEY_PREFIX = FLASH_STOCK_KEY_PREFIX;

  // 构造函数：注入 Redis 与数据库
  constructor(
    private readonly redis: RedisService, // Redis 客户端
    private readonly prisma: PrismaService, // 数据库兜底查询
  ) {}

  // 预热库存：活动开始时由 Worker 写入剩余（stock - sold）
  async warmup(activityId: number, remaining: number): Promise<void> {
    await this.redis.set(this.key(activityId), String(remaining));
  }

  // 预扣库存：DECR 后小于 0 说明已售罄，回补并返回 false
  async preDeduct(activityId: number): Promise<boolean> {
    // 原子递减，返回值即递减后的剩余
    const next = await this.redis.decr(this.key(activityId));
    if (next < 0) {
      // 越过 0 的操作必须回滚，保持计数为 0
      await this.redis.incr(this.key(activityId));
      return false;
    }
    return true;
  }

  // 回补预占：订单创建失败、支付失败或超时取消时调用
  async restore(activityId: number): Promise<void> {
    await this.redis.incr(this.key(activityId));
  }

  // 剩余库存：优先 Redis；键缺失时回源数据库并回填
  async remaining(activityId: number): Promise<number> {
    // 优先读取预占计数
    const cached = await this.redis.get(this.key(activityId));
    if (cached !== null) return Number(cached);

    // 缓存缺失：以数据库 stock - sold 为准
    const activity = await this.prisma.flashSaleActivity.findUnique({
      where: { id: activityId },
    });
    if (!activity) {
      throw new BizException(
        ErrorCode.RESOURCE_NOT_FOUND,
        '秒杀活动不存在',
        404,
      );
    }
    // 数据库剩余库存
    const remaining = activity.stock - activity.sold;
    // 回填 Redis，后续请求直接命中
    await this.redis.set(this.key(activityId), String(remaining));
    return remaining;
  }

  // 拼装活动库存键
  private key(activityId: number): string {
    return `${this.KEY_PREFIX}${activityId}`;
  }
}
