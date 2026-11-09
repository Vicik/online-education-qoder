import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { TradeModule } from '../../trade/trade.module';
import { FlashSaleAdminController } from './flash-sale.admin.controller';
import { FlashSaleAdminService } from './flash-sale.admin.service';
import { FlashSaleUserController } from './flash-sale.user.controller';
import { FlashSaleUserService } from './flash-sale.user.service';
import { FlashStockModule } from './flash-stock.module';

// 秒杀模块：用户端浏览/下单 + 管理端活动管理 + Redis 库存封装
// 计价策略与支付后钩子在 TradeModule 聚合注册（Nest 无 multi provider）
@Module({
  imports: [TradeModule, FlashStockModule],
  controllers: [FlashSaleUserController, FlashSaleAdminController],
  providers: [
    FlashSaleUserService, // 用户端列表、详情与下单
    FlashSaleAdminService, // 管理端活动 CRUD
    IdempotencyService, // 下单幂等
  ],
  // 步骤 12 Worker 通过上游模块注入库存服务（预热/超时回补）
  exports: [FlashStockModule],
})
export class FlashSaleModule {}
