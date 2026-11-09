import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { SessionGuard } from './common/guards/session.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CatalogModule } from './catalog/catalog.module';
import { LearningModule } from './learning/learning.module';
import { PromotionModule } from './promotion/promotion.module';
import { TradeModule } from './trade/trade.module';
import { ExamModule } from './exam/exam.module';
import { CommunityModule } from './community/community.module';
import { JobsModule } from './jobs/jobs.module';
import { StorageModule } from './storage/storage.module';

// 应用根模块：整合所有功能模块和全局提供者
@Module({
  imports: [
    AppConfigModule, // 配置
    PrismaModule, // 数据库
    RedisModule, // Redis
    AuditModule, // 审计日志（全局）
    HealthModule, // 健康检查
    AuthModule, // 认证与会话
    UsersModule, // 用户中心
    CatalogModule, // 课程浏览（用户端）
    LearningModule, // 学习进度与收藏
    PromotionModule, // 优惠券（模板管理与领取）
    TradeModule, // 订单与模拟支付
    ExamModule, // 题库与考试
    CommunityModule, // 学习社区（帖子/评论/点赞/屏蔽词）
    StorageModule, // 文件上传与对象存储
    JobsModule, // Worker 定时任务（仅 WORKER_MODE 下启动调度）
  ],
  providers: [
    // 全局会话守卫：验证用户登录状态
    { provide: APP_GUARD, useClass: SessionGuard },
    // 全局角色守卫：验证用户权限
    { provide: APP_GUARD, useClass: RolesGuard },
    // 全局响应拦截器：统一响应格式
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    // 全局异常过滤器：统一异常处理
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
