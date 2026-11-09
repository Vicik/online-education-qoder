import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { LockService } from './lock.service';
import { RateLimitService } from './rate-limit.service';

// Redis 全局模块：提供 Redis 相关服务，全局可用
@Global() // 标记为全局模块
@Module({
  providers: [RedisService, LockService, RateLimitService], // 注册 Redis 相关服务
  exports: [RedisService, LockService, RateLimitService], // 导出服务供其他模块使用
})
export class RedisModule {}
