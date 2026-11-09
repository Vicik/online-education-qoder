import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { TradeModule } from '../../trade/trade.module';
import { GrouponAdminController } from './groupon.admin.controller';
import { GrouponAdminService } from './groupon.admin.service';
import {
  GrouponUserController,
  MyGrouponController,
} from './groupon.user.controller';
import { GrouponUserService } from './groupon.user.service';

// 拼团模块：用户端浏览/开团/参团/我的拼团 + 管理端活动管理
// 计价策略与支付后钩子在 TradeModule 聚合注册（Nest 无 multi provider）
@Module({
  imports: [TradeModule],
  controllers: [
    GrouponUserController,
    MyGrouponController,
    GrouponAdminController,
  ],
  providers: [GrouponUserService, GrouponAdminService, IdempotencyService],
  // 步骤 12 Worker 通过上游模块注入该服务
  exports: [GrouponUserService],
})
export class GrouponModule {}
