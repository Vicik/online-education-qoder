import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// 工作台模块：管理端统计接口
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
