import { Injectable } from '@nestjs/common';
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
import { assertNoActivityOverlap } from '../activity-overlap';
import { deriveActivityStatus } from '../activity-status';
import { CreateGrouponDto } from './dto/create-groupon.dto';
import { UpdateGrouponDto } from './dto/update-groupon.dto';
import { GrouponActivityBrief, toActivityBrief } from './groupon.mapper';

// 乐观锁冲突提示：与优惠券模块保持一致
const VERSION_CONFLICT_MESSAGE = '数据已被修改，请刷新后重试';

// 解析时间入参：DTO 为 ISO 字符串，内部直接调用时可能已是 Date
function parseDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

// 校验活动时间：必须为合法日期且结束晚于开始（openapi 422 语义）
function assertPeriod(startAt: Date, endAt: Date): void {
  if (
    Number.isNaN(startAt.getTime()) ||
    Number.isNaN(endAt.getTime()) ||
    startAt.getTime() >= endAt.getTime()
  ) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '活动时间不合法：结束时间必须晚于开始时间',
      422,
    );
  }
}

// 校验成团人数：整数且不少于 2 人
function assertTargetSize(targetSize: number): void {
  if (!Number.isInteger(targetSize) || targetSize < 2) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '成团人数必须为不小于 2 的整数',
      422,
    );
  }
}

// 校验拼团价：整数且不为负
function assertPrice(priceCents: number): void {
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '拼团价必须为不小于 0 的整数',
      422,
    );
  }
}

// 拼团活动管理端服务：活动 CRUD、时间重叠校验与乐观锁
@Injectable()
export class GrouponAdminService {
  // 构造函数：注入 Prisma 与审计服务
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // 创建活动：仅已发布课程、时间合法、同课程活动时间不重叠
  async create(
    dto: CreateGrouponDto,
    context?: AuditContext,
  ): Promise<GrouponActivityBrief> {
    // 课程必须存在且已发布
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
      select: { id: true, status: true },
    });
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }
    if (course.status !== 'published') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '仅已发布课程可创建拼团活动',
        422,
      );
    }

    // 时间与人数、价格的服务层兜底校验
    const startAt = parseDate(dto.startAt);
    const endAt = parseDate(dto.endAt);
    assertPeriod(startAt, endAt);
    assertTargetSize(dto.targetSize);
    assertPrice(dto.priceCents);
    // 同课程活动时间不得与秒杀/拼团重叠（§6.2 同一时间只能参加一种活动）
    await assertNoActivityOverlap(this.prisma, dto.courseId, startAt, endAt);

    // 新建活动默认未开始，状态流转由 Worker 按时间推进
    const created = await this.prisma.grouponActivity.create({
      data: {
        courseId: dto.courseId,
        name: dto.name,
        priceCents: dto.priceCents,
        targetSize: dto.targetSize,
        startAt,
        endAt,
        status: 'not_started',
      },
      include: { course: { select: { name: true } } },
    });

    // 管理端写操作留痕
    await recordAudit(this.audit, context, {
      action: 'groupon.create',
      targetType: 'groupon',
      targetId: created.id,
      after: created,
    });

    return toActivityBrief(created);
  }

  // 编辑活动：仅未开始可改，version 乐观锁，重校验时间与重叠
  async update(
    activityId: number,
    dto: UpdateGrouponDto,
    context?: AuditContext,
  ): Promise<GrouponActivityBrief> {
    // 当前活动（带课程名称用于响应）
    const current = await this.prisma.grouponActivity.findUnique({
      where: { id: activityId },
      include: { course: { select: { name: true } } },
    });
    if (!current) {
      throw new BizException(
        ErrorCode.RESOURCE_NOT_FOUND,
        '拼团活动不存在',
        404,
      );
    }
    // 进行中/已结束/已取消均不可编辑
    if (current.status !== 'not_started') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '仅未开始活动可编辑',
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

    // 合并后的最终值用于校验与落库
    const startAt = dto.startAt ? parseDate(dto.startAt) : current.startAt;
    const endAt = dto.endAt ? parseDate(dto.endAt) : current.endAt;
    const priceCents = dto.priceCents ?? current.priceCents;
    const targetSize = dto.targetSize ?? current.targetSize;
    assertPeriod(startAt, endAt);
    assertTargetSize(targetSize);
    assertPrice(priceCents);
    // 编辑后仍需满足跨类型时间不重叠（排除自身）
    await assertNoActivityOverlap(
      this.prisma,
      current.courseId,
      startAt,
      endAt,
      {
        grouponId: activityId,
      },
    );

    // 可写字段：courseId 不在开放编辑范围内
    const data = {
      ...(dto.name === undefined ? {} : { name: dto.name }),
      priceCents,
      targetSize,
      startAt,
      endAt,
    };

    // 条件更新：状态与版本同时匹配才生效，防止并发覆盖
    const { count } = await this.prisma.grouponActivity.updateMany({
      where: { id: activityId, version: dto.version, status: 'not_started' },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    // 管理端写操作留痕
    await recordAudit(this.audit, context, {
      action: 'groupon.update',
      targetType: 'groupon',
      targetId: activityId,
      before: current,
      after: data,
    });

    return toActivityBrief({
      ...current,
      ...data,
      version: current.version + 1,
    });
  }

  // 取消活动：仅未开始可取消，可选 version 乐观锁
  async cancel(
    activityId: number,
    dto?: { version?: number },
    context?: AuditContext,
  ): Promise<GrouponActivityBrief> {
    // 当前活动（带课程名称用于响应）
    const current = await this.prisma.grouponActivity.findUnique({
      where: { id: activityId },
      include: { course: { select: { name: true } } },
    });
    if (!current) {
      throw new BizException(
        ErrorCode.RESOURCE_NOT_FOUND,
        '拼团活动不存在',
        404,
      );
    }
    // 已开始/已结束/已取消不可再取消
    if (current.status !== 'not_started') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '仅未开始活动可取消',
        422,
      );
    }
    // 传入版本号时做前置比对
    if (dto?.version !== undefined && dto.version !== current.version) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    // 条件更新：状态守卫防并发下重复取消
    const { count } = await this.prisma.grouponActivity.updateMany({
      where: {
        id: activityId,
        status: 'not_started',
        ...(dto?.version === undefined ? {} : { version: dto.version }),
      },
      data: { status: 'cancelled', version: { increment: 1 } },
    });
    if (count === 0) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    // 管理端写操作留痕
    await recordAudit(this.audit, context, {
      action: 'groupon.cancel',
      targetType: 'groupon',
      targetId: activityId,
      before: { status: current.status },
      after: { status: 'cancelled' },
    });

    return toActivityBrief({
      ...current,
      status: 'cancelled',
      version: current.version + 1,
    });
  }

  // 管理端列表：全状态 + 课程名联查
  async listAll(page: PageQuery): Promise<PageResult<GrouponActivityBrief>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 展示状态按时间推导：Worker 停摆或滞后时管理端仍显示正确状态
    const now = new Date();

    const [rows, total] = await Promise.all([
      // 当前页活动（带课程名称）
      this.prisma.grouponActivity.findMany({
        include: { course: { select: { name: true } } },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      // 总条数（全状态）
      this.prisma.grouponActivity.count(),
    ]);

    return {
      items: rows.map((row) =>
        toActivityBrief({ ...row, status: deriveActivityStatus(row, now) }),
      ),
      total,
      page: pageNo,
      pageSize,
    };
  }
}
