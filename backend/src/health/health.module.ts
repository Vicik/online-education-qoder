import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// 健康检查模块：注册健康检查控制器，提供存活和就绪检查功能
@Module({
  controllers: [HealthController], // 注册健康检查控制器
})
export class HealthModule {}
