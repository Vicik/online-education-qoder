import { Module } from '@nestjs/common';
import { CouponAdminController } from './coupon/coupon.admin.controller';
import { CouponAdminService } from './coupon/coupon.admin.service';
import {
  CouponClaimController,
  CourseCouponController,
  MyCouponController,
} from './coupon/coupon.user.controller';
import { CouponUserService } from './coupon/coupon.user.service';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { FlashSaleModule } from './flash-sale/flash-sale.module';
import { GrouponModule } from './groupon/groupon.module';

// 促销模块：优惠券（模板管理/领取/我的券）、拼团与秒杀（独立子模块）
@Module({
  // 拼团/秒杀子模块自包含控制器与服务，并复用交易模块的计价/下单/支付网关
  imports: [GrouponModule, FlashSaleModule],
  controllers: [
    CourseCouponController,
    CouponClaimController,
    MyCouponController,
    CouponAdminController,
  ],
  providers: [CouponUserService, CouponAdminService, IdempotencyService],
  // 透传拼团/秒杀服务，供步骤 12 Worker 经 PromotionModule 注入
  exports: [GrouponModule, FlashSaleModule],
})
export class PromotionModule {}
