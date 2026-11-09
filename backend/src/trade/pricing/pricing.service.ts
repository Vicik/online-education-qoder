import { Inject, Injectable } from '@nestjs/common';
import { ActivityType } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { BizException } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { CheckoutQuery } from '../dto/checkout-query.dto';
import {
  CheckoutPreviewData,
  PRICING_STRATEGIES,
  PricingStrategy,
} from './pricing.types';

// 计价服务：策略注册表与价格预览（服务端唯一计价入口）
@Injectable()
export class PricingService {
  // 活动类型 -> 策略索引
  private readonly strategiesByType: Map<ActivityType, PricingStrategy>;

  // 构造函数：注入 Prisma 与全部已注册策略
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PRICING_STRATEGIES) strategies: PricingStrategy[],
  ) {
    // 建立活动类型到策略的索引
    this.strategiesByType = new Map(
      strategies.map((strategy) => [strategy.activityType, strategy]),
    );
  }

  // 查询活动类型对应的计价策略；未注册视为参数无效
  resolve(activityType: ActivityType): PricingStrategy {
    // 按活动类型查找策略
    const strategy = this.strategiesByType.get(activityType);
    // 未注册的策略说明请求了不支持的活动类型
    if (!strategy) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        `不支持的活动类型：${activityType}`,
        400,
      );
    }
    return strategy;
  }

  // 校验并返回券抵扣额：本人、未使用、模板启用、适用课程、在有效期内
  async couponDiscount(
    userId: number, // 下单用户
    courseId: number, // 下单课程
    couponClaimId: number, // 券领取记录 id
  ): Promise<number> {
    // 服务端当前时间：有效期以服务端为准
    const now = new Date();
    // 联查券模板与适用课程，一次读全校验所需字段
    const claim = await this.prisma.couponClaim.findUnique({
      where: { id: couponClaimId },
      include: { template: { include: { courses: true } } },
    });
    // 逐条校验可用条件
    const usable =
      claim !== null && // 领取记录存在
      claim.userId === userId && // 归属本人
      claim.status === 'unused' && // 未使用
      claim.template.status === 'enabled' && // 模板启用
      claim.template.startAt <= now && // 已生效
      claim.template.endAt >= now && // 未过期
      claim.template.courses.some((course) => course.courseId === courseId); // 适用当前课程
    // 任一条件不满足统一按券不可用处理
    if (!usable) {
      throw new BizException(ErrorCode.COUPON_UNAVAILABLE, '优惠券不可用', 422);
    }
    return claim.template.discountCents;
  }

  // 价格预览：策略价 + 券校验，全部由服务端计算
  async preview(
    userId: number, // 当前用户
    courseId: number, // 课程 id
    query: CheckoutQuery, // 预览参数（券/活动）
  ): Promise<CheckoutPreviewData> {
    // 课程基础信息：原价取课程数据，不存在直接 404
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    // 课程不存在
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }

    // 活动类型默认普通购买
    const activityType = query.activityType ?? 'normal';
    // 由对应策略校验活动有效性并给出当前价
    const quote = await this.resolve(activityType).quote({
      courseId,
      activityId: query.activityId ?? null,
    });

    // 未选券不产生抵扣；选券则走统一券校验
    const discountCents =
      query.couponId == null
        ? 0
        : await this.couponDiscount(userId, courseId, query.couponId);

    return {
      courseId,
      activityType: quote.activityType,
      activityId: quote.activityId,
      originalCents: course.originalCents, // 原价始终取课程原价
      currentCents: quote.priceCents, // 当前价来自计价策略
      discountCents,
      paidCents: Math.max(0, quote.priceCents - discountCents), // 实付不为负
      couponClaimId: query.couponId ?? null,
    };
  }
}
