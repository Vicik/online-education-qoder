import { Module } from '@nestjs/common';
import { ExamModule } from '../exam/exam.module';
import { PromotionModule } from '../promotion/promotion.module';
import { LockService } from '../redis/lock.service';
import { TradeModule } from '../trade/trade.module';
import { ActivityStatusJob } from './activity-status.job';
import { CouponExpiryJob } from './coupon-expiry.job';
import { ExamAutoSubmitJob } from './exam-auto-submit.job';
import { FlashStockWarmupJob } from './flash-stock-warmup.job';
import { GrouponExpiryJob } from './groupon-expiry.job';
import { JOB_LOCK, JOBS, Job, JobsScheduler } from './jobs.scheduler';
import { OrderTimeoutJob } from './order-timeout.job';

// 定时任务模块：装配六个任务与调度器（Worker 进程使用）
@Module({
  imports: [
    TradeModule, // 订单超时取消
    PromotionModule, // 拼团到期、秒杀预热、券过期
    ExamModule, // 考试兜底交卷
  ],
  providers: [
    GrouponExpiryJob, // 拼团到期
    OrderTimeoutJob, // 订单超时取消
    CouponExpiryJob, // 券过期标记
    ActivityStatusJob, // 活动状态流转
    ExamAutoSubmitJob, // 考试兜底交卷
    FlashStockWarmupJob, // 秒杀库存预热
    JobsScheduler, // 扫描循环 + 锁包装
    // 任务锁令牌：复用 Redis 分布式锁实现，便于单测替换
    { provide: JOB_LOCK, useExisting: LockService },
    // 任务集合：Nest 无 multi provider，用工厂按固定顺序聚合
    {
      provide: JOBS,
      useFactory: (
        grouponExpiry: GrouponExpiryJob,
        orderTimeout: OrderTimeoutJob,
        couponExpiry: CouponExpiryJob,
        activityStatus: ActivityStatusJob,
        examAutoSubmit: ExamAutoSubmitJob,
        flashStockWarmup: FlashStockWarmupJob,
      ): Job[] => [
        grouponExpiry,
        orderTimeout,
        couponExpiry,
        activityStatus,
        examAutoSubmit,
        flashStockWarmup,
      ],
      inject: [
        GrouponExpiryJob,
        OrderTimeoutJob,
        CouponExpiryJob,
        ActivityStatusJob,
        ExamAutoSubmitJob,
        FlashStockWarmupJob,
      ],
    },
  ],
  exports: [JobsScheduler], // Worker 入口显式获取以触发初始化
})
export class JobsModule {}
