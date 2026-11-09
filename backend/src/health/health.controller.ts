import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// 健康检查控制器：提供应用存活和就绪状态的检查接口
@Public() // 标记为公开接口，无需身份验证
@Controller()
export class HealthController {
  // 构造函数：注入 Prisma 服务和 Redis 服务
  constructor(
    private readonly prisma: PrismaService, // 数据库服务
    private readonly redis: RedisService, // Redis 缓存服务
  ) {}

  // 存活检查接口：返回应用是否存活
  @Get('healthz')
  healthz() {
    return { status: 'ok' }; // 返回存活状态
  }

  // 就绪检查接口：检查依赖服务是否就绪
  @Get('readyz')
  async readyz() {
    try {
      // 检查数据库连接是否正常
      await this.prisma.$queryRaw`SELECT 1`;
      // 检查 Redis 连接是否正常
      await this.redis.ping();
    } catch {
      // 依赖服务不可用时抛出 503 异常
      throw new ServiceUnavailableException('依赖未就绪');
    }
    // 所有依赖就绪
    return { status: 'ready' };
  }
}
