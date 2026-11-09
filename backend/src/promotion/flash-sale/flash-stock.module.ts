import { Module } from '@nestjs/common';
import { FlashStockService } from './flash-stock.service';

// 秒杀库存独立模块：只依赖全局 Redis/Prisma，供交易与秒杀模块共享
// 独立成模块避免 TradeModule 反向导入 FlashSaleModule 形成循环依赖
@Module({
  providers: [FlashStockService], // Redis 预扣/回补/剩余
  exports: [FlashStockService], // 供 FlashSaleModule 与 TradeModule 注入
})
export class FlashStockModule {}
