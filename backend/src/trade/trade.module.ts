import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { CouponUserService } from '../promotion/coupon/coupon.user.service';
import { GrouponPostPaymentHandler } from '../promotion/groupon/groupon-post-payment.handler';
import { GrouponPricingStrategy } from '../promotion/groupon/groupon-pricing.strategy';
import { FlashSalePostPaymentHandler } from '../promotion/flash-sale/flash-sale-post-payment.handler';
import { FlashSalePricingStrategy } from '../promotion/flash-sale/flash-sale-pricing.strategy';
import { FlashStockModule } from '../promotion/flash-sale/flash-stock.module';
import { FlashStockService } from '../promotion/flash-sale/flash-stock.service';
import {
  MyOrderController,
  OrderController,
  CheckoutController,
} from './order/order.controller';
import { OrderAdminController } from './order/order.admin.controller';
import { FLASH_STOCK_RESTORE, OrderService } from './order/order.service';
import { MockPaymentGateway } from './payment/mock-payment.gateway';
import { PAYMENT_GATEWAY } from './payment/payment-gateway.interface';
import {
  NormalPostPaymentHandler,
  POST_PAYMENT_HANDLERS,
  PostPaymentHandler,
} from './payment/post-payment-handler.interface';
import { NormalPricingStrategy } from './pricing/normal-pricing.strategy';
import { PricingService } from './pricing/pricing.service';
import { PRICING_STRATEGIES, PricingStrategy } from './pricing/pricing.types';

// 交易模块：服务端计价、订单创建与模拟支付
@Module({
  imports: [FlashStockModule], // 共享 Redis 库存服务（超时取消回补预占）
  controllers: [
    CheckoutController,
    OrderController,
    MyOrderController,
    OrderAdminController,
  ],
  providers: [
    PricingService, // 计价服务（策略注册表 + 预览）
    OrderService, // 订单服务
    // 秒杀预占回补回调：由库存服务实现，避免 OrderService 直接依赖促销模块
    {
      provide: FLASH_STOCK_RESTORE,
      useFactory:
        (stock: FlashStockService) =>
        (activityId: number): Promise<void> =>
          stock.restore(activityId),
      inject: [FlashStockService],
    },
    CouponUserService, // 事务内核销券
    IdempotencyService, // 下单幂等
    NormalPricingStrategy, // 普通购买计价策略
    NormalPostPaymentHandler, // 普通订单支付后钩子（空实现）
    GrouponPricingStrategy, // 拼团计价策略（活动拼团价）
    GrouponPostPaymentHandler, // 拼团支付后钩子（行锁计团/满员成团）
    FlashSalePricingStrategy, // 秒杀计价策略（活动秒杀价）
    FlashSalePostPaymentHandler, // 秒杀支付后钩子（行锁扣减/失败回补）
    // 策略数组：NestJS 无 Angular 式 multi provider，用工厂聚合；
    // 必须在唯一的 TradeModule 容器内聚合，PricingService 才能看到全部策略
    {
      provide: PRICING_STRATEGIES,
      useFactory: (
        normal: NormalPricingStrategy,
        groupon: GrouponPricingStrategy,
        flashSale: FlashSalePricingStrategy,
      ): PricingStrategy[] => [normal, groupon, flashSale],
      inject: [
        NormalPricingStrategy,
        GrouponPricingStrategy,
        FlashSalePricingStrategy,
      ],
    },
    // 支付后钩子数组：同样用工厂聚合（含拼团与秒杀钩子）
    {
      provide: POST_PAYMENT_HANDLERS,
      useFactory: (
        normal: NormalPostPaymentHandler,
        groupon: GrouponPostPaymentHandler,
        flashSale: FlashSalePostPaymentHandler,
      ): PostPaymentHandler[] => [normal, groupon, flashSale],
      inject: [
        NormalPostPaymentHandler,
        GrouponPostPaymentHandler,
        FlashSalePostPaymentHandler,
      ],
    },
    // 模拟支付网关（真实渠道替换该 provider 即可）
    { provide: PAYMENT_GATEWAY, useClass: MockPaymentGateway },
  ],
  exports: [
    PricingService,
    OrderService,
    PRICING_STRATEGIES,
    POST_PAYMENT_HANDLERS,
    PAYMENT_GATEWAY,
  ],
})
export class TradeModule {}
