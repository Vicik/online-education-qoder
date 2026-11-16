import { Injectable } from '@nestjs/common';
import { CouponClaimStatus, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { PageQuery } from '../../common/dto/page-query.dto';
import { PageResult } from '../../common/dto/page-result';
import { BizException } from '../../common/exceptions/biz.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  COUPON_CLAIM_INCLUDE,
  COUPON_CLAIM_TEMPLATE_SELECT,
  COUPON_TEMPLATE_SELECT,
  CouponClaim,
  CouponTemplateView,
  claimKeyOf,
  toCouponClaim,
  toCouponTemplateBrief,
} from './coupon.mapper';

// 用户端优惠券服务：课程可领券、领取（限领/防超发/幂等）与我的券
@Injectable()
export class CouponUserService {
  // 构造函数：注入 Prisma 与幂等服务
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // 课程详情可领券列表：启用 + 在有效期 + 适用该课程 + 总量未发完
  async listForCourse(courseId: number): Promise<CouponTemplateView[]> {
    // 游客视角仅已发布课程可见，与课程详情口径一致
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, status: 'published' },
      select: { id: true },
    });
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }

    // 服务端当前时间：有效期与过期判定以服务端为准
    const now = new Date();
    // 适用该课程的券模板（状态与有效期在查询条件中过滤）
    const rows = await this.prisma.couponTemplateCourse.findMany({
      where: {
        courseId,
        template: {
          status: 'enabled',
          startAt: { lte: now },
          endAt: { gte: now },
        },
      },
      select: { template: { select: COUPON_TEMPLATE_SELECT } },
      orderBy: { template: { createdAt: 'desc' } },
    });

    // 总量已发完的不展示（claimedCount 只计未失效记录）
    return rows
      .map((row) => row.template)
      .filter((template) => template.claimedCount < template.totalQty)
      .map(toCouponTemplateBrief);
  }

  // 领取优惠券：限领 + 防超发 + 幂等
  async claim(
    userId: number,
    templateId: number,
    idempotencyKey: string,
  ): Promise<CouponClaim> {
    // 幂等端点含模板 id，避免同一幂等键跨模板命中错误结果
    return this.idempotency.run(
      userId,
      idempotencyKey,
      `POST /coupons/${templateId}/claim`,
      async () => {
        // 模板必须存在且启用
        const template = await this.prisma.couponTemplate.findUnique({
          where: { id: templateId },
          select: COUPON_CLAIM_TEMPLATE_SELECT,
        });
        if (!template) {
          throw new BizException(
            ErrorCode.RESOURCE_NOT_FOUND,
            '优惠券不存在',
            404,
          );
        }
        if (template.status !== 'enabled') {
          throw new BizException(
            ErrorCode.COUPON_UNAVAILABLE,
            '优惠券不可领取',
            422,
          );
        }
        // 领取有效期（服务端时间）
        const now = new Date();
        if (template.startAt > now || template.endAt < now) {
          throw new BizException(
            ErrorCode.COUPON_UNAVAILABLE,
            '不在领取有效期',
            422,
          );
        }
        // 限领（§9.3）：claimKey 非空即存在未失效记录（unused/used/restored/expired）
        const existing = await this.prisma.couponClaim.findFirst({
          where: { templateId, userId, claimKey: { not: null } },
          select: { id: true },
        });
        if (existing) {
          throw new BizException(
            ErrorCode.PARAM_INVALID,
            '该优惠券每人限领一张',
            409,
          );
        }

        try {
          // 防超发计数与领取记录同事务：唯一冲突时计数随事务回滚
          return await this.prisma.$transaction(async (tx) => {
            const { count } = await tx.couponTemplate.updateMany({
              where: {
                id: templateId,
                status: 'enabled',
                claimedCount: { lt: template.totalQty },
              },
              data: { claimedCount: { increment: 1 } },
            });
            if (count === 0) {
              throw new BizException(
                ErrorCode.COUPON_UNAVAILABLE,
                '优惠券已被领完',
                422,
              );
            }
            const created = await tx.couponClaim.create({
              data: {
                templateId,
                userId,
                claimKey: claimKeyOf(templateId, userId),
              },
            });
            return toCouponClaim({ ...created, template });
          });
        } catch (error) {
          // 并发下 claimKey 唯一约束冲突：另一请求已领取
          if ((error as { code?: string }).code === 'P2002') {
            throw new BizException(
              ErrorCode.PARAM_INVALID,
              '该优惠券每人限领一张',
              409,
            );
          }
          throw error;
        }
      },
    );
  }

  // 我的券：按状态筛选分页，含模板展示字段
  async listMine(
    userId: number,
    status?: CouponClaimStatus,
    page?: PageQuery,
  ): Promise<PageResult<CouponClaim>> {
    // 分页参数兜底
    const pageNo = page?.page ?? 1;
    const pageSize = page?.pageSize ?? 20;
    // 查询条件：本人 + 可选状态
    const where: Prisma.CouponClaimWhereInput = {
      userId,
      ...(status ? { status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.couponClaim.findMany({
        where,
        include: COUPON_CLAIM_INCLUDE,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { claimedAt: 'desc' },
      }),
      this.prisma.couponClaim.count({ where }),
    ]);

    return {
      items: rows.map(toCouponClaim),
      total,
      page: pageNo,
      pageSize,
    };
  }

  // 【供步骤 07 事务内调用】核销：unused → used 且 usedAt 置位
  // orderId 仅用于调用方语义；券表不存订单 id（订单侧 couponClaimId 反向关联）
  async redeemInTx(
    tx: Prisma.TransactionClient,
    claimId: number,
    userId: number,
    _orderId: number,
  ): Promise<CouponClaim> {
    // 条件更新：仅本人未使用记录可核销
    const { count } = await tx.couponClaim.updateMany({
      where: { id: claimId, userId, status: 'unused' },
      data: { status: 'used', usedAt: new Date() },
    });
    if (count === 0) {
      throw new BizException(ErrorCode.COUPON_UNAVAILABLE, '优惠券不可用', 422);
    }
    // 返回核销后的完整领取记录
    const row = await tx.couponClaim.findUniqueOrThrow({
      where: { id: claimId },
      include: COUPON_CLAIM_INCLUDE,
    });
    return toCouponClaim(row);
  }

  // 【供步骤 12 Worker 调用】恢复：used → restored（退款场景，幂等）
  async restoreInTx(
    tx: Prisma.TransactionClient,
    claimId: number,
  ): Promise<void> {
    await tx.couponClaim.updateMany({
      where: { id: claimId, status: 'used' },
      data: { status: 'restored' },
    });
  }
}
