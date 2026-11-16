import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

// 工作台控制器：仅管理员可访问（/api/v1/admin/dashboard）
@Controller('admin/dashboard')
@Roles('admin')
export class DashboardController {
  // 构造函数：注入统计服务
  constructor(private readonly dashboard: DashboardService) {}

  // 工作台统计
  @Get('stats')
  stats() {
    return this.dashboard.stats();
  }
}
