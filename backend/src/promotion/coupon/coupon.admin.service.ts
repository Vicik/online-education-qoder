import { Injectable } from '@nestjs/common';
import { CouponTemplateStatus, Prisma } from '@prisma/client';
import {
  AuditContext,
  AuditService,
  recordAudit,
} from '../../audit/audit.service';
import { ErrorCode } from '../../common/constants/error-codes';
import { PageQuery } from '../../common/dto/page-query.dto';
import { PageResult } from '../../common/dto/page-result';
import { BizException } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../prisma/prisma.service';
import {
  COUPON_TEMPLATE_SELECT,
  CouponTemplateView,
  toCouponTemplateBrief,
} from './coupon.mapper';
import { CreateCouponTemplateDto } from './dto/create-coupon-template.dto';
import { UpdateCouponTemplateDto } from './dto/update-coupon-template.dto';

// 乐观锁冲突提示
const VERSION_CONFLICT_MESSAGE = '数据已被修改，请刷新后重试';
// 每个模板每人限领数量：说明文档业务规则固定为 1
const FIXED_PER_USER_LIMIT = 1;

// 校验有效期：结束时间必须晚于开始时间且均为合法日期
function assertPeriod(startAt: Date, endAt: Date): void {
  if (
    Number.isNaN(startAt.getTime()) ||
    Number.isNaN(endAt.getTime()) ||
    startAt.getTime() >= endAt.getTime()
  ) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '有效期不合法：结束时间必须晚于开始时间',
      400,
    );
  }
}

// 校验面额与发放总量
function assertQuantity(discountCents: number, totalQty: number): void {
  if (!Number.isInteger(discountCents) || discountCents < 1) {
    throw new BizException(ErrorCode.PARAM_INVALID, '抵扣面额必须大于 0', 400);
  }
  if (!Number.isInteger(totalQty) || totalQty < 1) {
    throw new BizException(ErrorCode.PARAM_INVALID, '发放总量必须大于 0', 400);
  }
}

// 优惠券模板管理端服务：CRUD、启停与停用级联
@Injectable()
export class CouponAdminService {
  // 构造函数：注入 Prisma 与审计服务
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // 模板列表：可按状态筛选，关联课程转为 courseIds
  async list(
    page: PageQuery,
    status?: CouponTemplateStatus,
  ): Promise<PageResult<CouponTemplateView>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 状态筛选条件
    const where: Prisma.CouponTemplateWhereInput = status ? { status } : {};

    const [rows, total] = await Promise.all([
      // 当前页模板
      this.prisma.couponTemplate.findMany({
        where,
        select: COUPON_TEMPLATE_SELECT,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      // 总数
      this.prisma.couponTemplate.count({ where }),
    ]);

    return {
      items: rows.map(toCouponTemplateBrief),
      total,
      page: pageNo,
      pageSize,
    };
  }

  // 模板详情
  async getDetail(templateId: number): Promise<CouponTemplateView> {
    const row = await this.prisma.couponTemplate.findUnique({
      where: { id: templateId },
      select: COUPON_TEMPLATE_SELECT,
    });
    if (!row) {
      throw new BizException(
        ErrorCode.RESOURCE_NOT_FOUND,
        '优惠券模板不存在',
        404,
      );
    }
    return toCouponTemplateBrief(row);
  }

  // 创建模板：默认停用，perUserLimit 强制 1，模板与课程关联同事务
  async create(
    dto: CreateCouponTemplateDto,
    context?: AuditContext,
  ): Promise<CouponTemplateView> {
    // 服务层兜底校验（直接调用服务时未必经过 ValidationPipe）
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    assertPeriod(startAt, endAt);
    assertQuantity(dto.discountCents, dto.totalQty);
    // 适用课程：去重后必须全部已发布
    const courseIds = await this.assertCoursesPublished(dto.courseIds);
    // 默认不启用；enableOnCreate=true 时创建即启用
    const status: CouponTemplateStatus = dto.enableOnCreate
      ? 'enabled'
      : 'disabled';

    // 模板与关联课程同事务写入
    const created = await this.prisma.$transaction(async (tx) => {
      const template = await tx.couponTemplate.create({
        data: {
          name: dto.name,
          discountCents: dto.discountCents,
          startAt,
          endAt,
          totalQty: dto.totalQty,
          perUserLimit: FIXED_PER_USER_LIMIT,
          status,
        },
      });
      await tx.couponTemplateCourse.createMany({
        data: courseIds.map((courseId) => ({
          templateId: template.id,
          courseId,
        })),
      });
      return template;
    });

    await recordAudit(this.audit, context, {
      action: 'coupon.create',
      targetType: 'coupon',
      targetId: created.id,
      after: created,
    });

    return toCouponTemplateBrief({
      ...created,
      courses: courseIds.map((courseId) => ({ courseId })),
    });
  }

  // 编辑模板：仅停用态可改，version 乐观锁，课程关联整体重设
  async update(
    templateId: number,
    dto: UpdateCouponTemplateDto,
    context?: AuditContext,
  ): Promise<CouponTemplateView> {
    // 当前模板
    const current = await this.prisma.couponTemplate.findUnique({
      where: { id: templateId },
      select: COUPON_TEMPLATE_SELECT,
    });
    if (!current) {
      throw new BizException(
        ErrorCode.RESOURCE_NOT_FOUND,
        '优惠券模板不存在',
        404,
      );
    }
    // 启用态只读
    if (current.status !== 'disabled') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '优惠券模板已启用，请先停用后再编辑',
        422,
      );
    }
    // 版本前置比对：明显过期的请求不必进入写库
    if (dto.version !== current.version) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    // 合并后的最终值用于校验
    const startAt = dto.startAt ? new Date(dto.startAt) : current.startAt;
    const endAt = dto.endAt ? new Date(dto.endAt) : current.endAt;
    const discountCents = dto.discountCents ?? current.discountCents;
    const totalQty = dto.totalQty ?? current.totalQty;
    assertPeriod(startAt, endAt);
    assertQuantity(discountCents, totalQty);
    // 发放总量不得低于已领取数量，避免条件更新失效导致超发
    if (totalQty < current.claimedCount) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '发放总量不得小于当前已领取数量',
        422,
      );
    }
    // 传了 courseIds 才重设关联，否则沿用当前关联
    const courseIds =
      dto.courseIds === undefined
        ? current.courses.map((course) => course.courseId)
        : await this.assertCoursesPublished(dto.courseIds);

    // 可写字段（perUserLimit 恒为 1）
    const data = {
      ...(dto.name === undefined ? {} : { name: dto.name }),
      discountCents,
      startAt,
      endAt,
      totalQty,
      perUserLimit: FIXED_PER_USER_LIMIT,
    };

    // 条件更新 + 关联重设同事务
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.couponTemplate.updateMany({
        where: { id: templateId, version: dto.version, status: 'disabled' },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new BizException(
          ErrorCode.IDEMPOTENCY_CONFLICT,
          VERSION_CONFLICT_MESSAGE,
          409,
        );
      }
      if (dto.courseIds !== undefined) {
        await tx.couponTemplateCourse.deleteMany({ where: { templateId } });
        await tx.couponTemplateCourse.createMany({
          data: courseIds.map((courseId) => ({ templateId, courseId })),
        });
      }
    });

    await recordAudit(this.audit, context, {
      action: 'coupon.update',
      targetType: 'coupon',
      targetId: templateId,
      before: current,
      after: data,
    });

    return toCouponTemplateBrief({
      ...current,
      ...data,
      version: current.version + 1,
      courses: courseIds.map((courseId) => ({ courseId })),
    });
  }

  // 启用模板：停用 → 启用（不恢复历史已失效记录）
  async enable(
    templateId: number,
    context?: AuditContext,
  ): Promise<CouponTemplateView> {
    // 当前模板
    const current = await this.prisma.couponTemplate.findUnique({
      where: { id: templateId },
      select: COUPON_TEMPLATE_SELECT,
    });
    if (!current) {
      throw new BizException(
        ErrorCode.RESOURCE_NOT_FOUND,
        '优惠券模板不存在',
        404,
      );
    }
    if (current.status !== 'disabled') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '仅停用状态的优惠券可启用',
        422,
      );
    }

    const { count } = await this.prisma.couponTemplate.updateMany({
      where: { id: templateId, status: 'disabled' },
      data: { status: 'enabled', version: { increment: 1 } },
    });
    if (count === 0) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    await recordAudit(this.audit, context, {
      action: 'coupon.enable',
      targetType: 'coupon',
      targetId: templateId,
      before: { status: current.status },
      after: { status: 'enabled' },
    });

    return toCouponTemplateBrief({
      ...current,
      status: 'enabled',
      version: current.version + 1,
    });
  }

  // 停用模板：启用 → 停用，并级联未使用/已恢复记录为已失效
  async disable(
    templateId: number,
    dto?: { version?: number },
    context?: AuditContext,
  ): Promise<CouponTemplateView> {
    // 当前模板
    const current = await this.prisma.couponTemplate.findUnique({
      where: { id: templateId },
      select: COUPON_TEMPLATE_SELECT,
    });
    if (!current) {
      throw new BizException(
        ErrorCode.RESOURCE_NOT_FOUND,
        '优惠券模板不存在',
        404,
      );
    }
    if (current.status !== 'enabled') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '仅启用状态的优惠券可停用',
        422,
      );
    }
    // 版本前置比对
    if (dto?.version !== undefined && dto.version !== current.version) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    // 事务内：模板状态流转 + 领取记录级联失效
    const { invalidated } = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.couponTemplate.updateMany({
        where: {
          id: templateId,
          status: 'enabled',
          ...(dto?.version === undefined ? {} : { version: dto.version }),
        },
        data: { status: 'disabled', version: { increment: 1 } },
      });
      if (count === 0) {
        throw new BizException(
          ErrorCode.IDEMPOTENCY_CONFLICT,
          VERSION_CONFLICT_MESSAGE,
          409,
        );
      }
      // claimKey 置 NULL 即解除限领唯一约束，允许模板重新启用后再领
      const cascade = await tx.couponClaim.updateMany({
        where: {
          templateId,
          status: { in: ['unused', 'restored'] },
        },
        data: { status: 'invalid', claimKey: null },
      });
      if (cascade.count > 0) {
        // claimedCount 只计未失效记录，级联失效后同步扣减
        await tx.couponTemplate.updateMany({
          where: { id: templateId },
          data: { claimedCount: { decrement: cascade.count } },
        });
      }
      return { invalidated: cascade.count };
    });

    await recordAudit(this.audit, context, {
      action: 'coupon.disable',
      targetType: 'coupon',
      targetId: templateId,
      before: { status: current.status },
      after: { status: 'disabled', invalidated },
    });

    return toCouponTemplateBrief({
      ...current,
      status: 'disabled',
      version: current.version + 1,
      claimedCount: Math.max(0, current.claimedCount - invalidated),
    });
  }

  // 校验关联课程：去重、非空且全部已发布
  private async assertCoursesPublished(courseIds: number[]): Promise<number[]> {
    // 去重后的课程 id
    const ids = [...new Set(courseIds ?? [])];
    if (ids.length === 0) {
      throw new BizException(ErrorCode.PARAM_INVALID, '至少关联一门课程', 400);
    }
    // 已发布课程
    const published = await this.prisma.course.findMany({
      where: { id: { in: ids }, status: 'published' },
      select: { id: true },
    });
    if (published.length !== ids.length) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '适用课程必须全部为已发布状态',
        422,
      );
    }
    return ids;
  }
}
