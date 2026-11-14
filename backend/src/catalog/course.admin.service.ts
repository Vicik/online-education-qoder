import { Injectable } from '@nestjs/common';
import { Course, CourseStatus, Prisma } from '@prisma/client';
import {
  AuditContext,
  AuditService,
  recordAudit,
} from '../audit/audit.service';
import { ErrorCode } from '../common/constants/error-codes';
import { PageQuery } from '../common/dto/page-query.dto';
import { PageResult } from '../common/dto/page-result';
import { BizException } from '../common/exceptions/biz.exception';
import { sanitizeRichHtml } from '../common/utils/sanitize.util';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  COURSE_BRIEF_SELECT,
  CourseBrief,
  CourseDetail,
  CourseService,
  toCourseBrief,
} from './course.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

// 课程名称最大字符数
const NAME_MAX_LENGTH = 40;
// 已发布状态可编辑字段：§3.3 要求先下架才能修改任何基本信息
const PUBLISHED_EDITABLE: readonly string[] = [];
// 已下架状态可编辑字段：仅讲师、封面、简介、详细介绍
const UNPUBLISHED_EDITABLE = [
  'instructor',
  'coverUrl',
  'intro',
  'detailRich',
] as const;
// 草稿状态可编辑字段：全部基本信息
const DRAFT_EDITABLE = [
  'name',
  'type',
  'originalCents',
  'saleCents',
  ...UNPUBLISHED_EDITABLE,
] as const;
// 状态到可编辑字段的映射（§3.3 状态矩阵）
const EDITABLE_FIELDS: Record<CourseStatus, readonly string[]> = {
  draft: DRAFT_EDITABLE,
  published: PUBLISHED_EDITABLE,
  unpublished: UNPUBLISHED_EDITABLE,
};
// 状态中文名：用于错误提示
const STATUS_LABEL: Record<CourseStatus, string> = {
  draft: '草稿',
  published: '已发布',
  unpublished: '已下架',
};
// 乐观锁冲突提示
const VERSION_CONFLICT_MESSAGE = '数据已被修改，请刷新后重试';

// 管理端课程列表项：简要信息 + 章节数 + 报名人数
export type AdminCourseListItem = CourseBrief & {
  chapterCount: number; // 章节数
  enrollmentCount: number; // 报名人数（已支付去重用户数）
};

// 从请求 DTO 中按白名单取值，忽略未传入的字段
function pickFields(
  source: object,
  keys: readonly string[],
): Record<string, unknown> {
  // 提取结果
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    // 只收集显式传入（非 undefined）的字段
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

// 富文本净化：仅对字符串内容净化，null/undefined 原样保留
function sanitizeDetailRich(
  value: string | null | undefined,
): string | null | undefined {
  return typeof value === 'string' ? sanitizeRichHtml(value) : value;
}

// 课程管理端服务：创建、编辑（状态矩阵 + 乐观锁）、发布/下架、列表与详情
@Injectable()
export class CourseAdminService {
  // 构造函数：注入 Prisma、审计服务、用户端课程服务与存储签名服务
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly courses: CourseService,
    private readonly storage: StorageService,
  ) {}

  // 管理端课程列表：全部状态可选筛选，附章节数与报名人数
  async listAll(
    page: PageQuery,
    status?: CourseStatus,
    withoutActivePromotion = false,
  ): Promise<PageResult<AdminCourseListItem>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 当前时刻：用于判断活动是否已结束（与展示状态推导一致，不依赖物化状态）
    const now = new Date();
    // 状态筛选条件
    const where: Prisma.CourseWhereInput = {
      ...(status ? { status } : {}),
      // 无有效活动的课程：未取消/未结束且尚未到结束时间的拼团与秒杀都不存在
      ...(withoutActivePromotion
        ? {
            grouponActivities: {
              none: {
                status: { notIn: ['ended', 'cancelled'] },
                endAt: { gte: now },
              },
            },
            flashSaleActivities: {
              none: {
                status: { notIn: ['ended', 'cancelled'] },
                endAt: { gte: now },
              },
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      // 当前页课程（含章节数）
      this.prisma.course.findMany({
        where,
        select: {
          ...COURSE_BRIEF_SELECT,
          isRecommended: true,
          _count: { select: { chapters: true } },
        },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      // 总数
      this.prisma.course.count({ where }),
    ]);

    // 当前页课程 id 集合
    const courseIds = rows.map((row) => row.id);
    // 报名人数：已支付订单按 (courseId, userId) 去重
    const paidOrders = courseIds.length
      ? await this.prisma.order.findMany({
          where: { courseId: { in: courseIds }, status: 'paid' },
          select: { courseId: true, userId: true },
          distinct: ['courseId', 'userId'],
        })
      : [];
    // 各课程报名人数
    const enrollmentByCourse = new Map<number, number>();
    for (const order of paidOrders) {
      enrollmentByCourse.set(
        order.courseId,
        (enrollmentByCourse.get(order.courseId) ?? 0) + 1,
      );
    }

    // 映射为管理端列表项（封面读取时签名）
    const items = await Promise.all(
      rows.map(async ({ _count, ...course }) => ({
        ...(await toCourseBrief(course, this.storage)),
        isRecommended: course.isRecommended,
        chapterCount: _count.chapters,
        enrollmentCount: enrollmentByCourse.get(course.id) ?? 0,
      })),
    );

    return { items, total, page: pageNo, pageSize };
  }

  // 创建课程：落草稿态，写审计
  async create(dto: CreateCourseDto, context?: AuditContext): Promise<Course> {
    // 服务层兜底校验（直接调用服务时未必经过 ValidationPipe）
    if (dto.name.length > NAME_MAX_LENGTH) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        `课程名称最多 ${NAME_MAX_LENGTH} 个字符`,
        400,
      );
    }
    // 售价不得高于原价
    if (dto.saleCents > dto.originalCents) {
      throw new BizException(ErrorCode.PARAM_INVALID, '售价不得高于原价', 400);
    }

    // 创建草稿课程
    const created = await this.prisma.course.create({
      data: {
        name: dto.name,
        type: dto.type,
        originalCents: dto.originalCents,
        saleCents: dto.saleCents,
        instructor: dto.instructor,
        coverUrl: dto.coverUrl,
        intro: dto.intro ?? null,
        detailRich: sanitizeDetailRich(dto.detailRich) ?? null,
        status: 'draft',
      },
    });

    await recordAudit(this.audit, context, {
      action: 'course.create',
      targetType: 'course',
      targetId: created.id,
      after: created,
    });

    return created;
  }

  // 管理端课程详情：含草稿/下架（复用用户端详情组装，取消状态过滤）
  async getDetail(courseId: number): Promise<CourseDetail> {
    return this.courses.getDetail(courseId, true);
  }

  // 编辑课程：按状态矩阵限制字段，version 乐观锁
  async update(
    courseId: number,
    dto: UpdateCourseDto,
    context?: AuditContext,
  ): Promise<Course> {
    // 当前课程
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }

    // 先做版本比对，避免明显过期的请求进入写库
    if (dto.version !== course.version) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    // 当前状态允许编辑的字段
    const editable = EDITABLE_FIELDS[course.status];
    // DTO 实例字段视图：transform 后未传入的字段也存在于实例上（值为 undefined）
    const submitted = dto as unknown as Record<string, unknown>;
    // 请求中显式传入且非 undefined 的字段（version 除外）
    const changedKeys = Object.keys(dto).filter(
      (key) => key !== 'version' && submitted[key] !== undefined,
    );
    for (const key of changedKeys) {
      // 非白名单字段按状态矩阵拒绝
      if (!editable.includes(key)) {
        // 已发布提示先下架，其余状态说明可改范围
        const hint =
          course.status === 'published'
            ? '，请先下架'
            : '，仅可修改讲师、封面、简介和详细介绍';
        throw new BizException(
          ErrorCode.PARAM_INVALID,
          `课程「${STATUS_LABEL[course.status]}」状态不可修改该字段${hint}`,
          422,
        );
      }
    }

    // 类型锁定：已有章节的草稿不可再改类型
    if (dto.type !== undefined && dto.type !== course.type) {
      // 已有章节数：>0 即类型已锁定
      const chapterCount = await this.prisma.chapter.count({
        where: { courseId },
      });
      if (chapterCount > 0) {
        throw new BizException(
          ErrorCode.PARAM_INVALID,
          '首个章节保存后课程类型不可修改，请先删除全部章节',
          422,
        );
      }
    }

    // 售价不得高于原价：以本次修改后的最终值为准
    // 本次修改后的原价与售价
    const originalCents = dto.originalCents ?? course.originalCents;
    // 本次修改后的售价
    const saleCents = dto.saleCents ?? course.saleCents;
    if (saleCents > originalCents) {
      throw new BizException(ErrorCode.PARAM_INVALID, '售价不得高于原价', 400);
    }

    // 白名单取值
    const data = pickFields(
      dto,
      editable,
    ) as Prisma.CourseUpdateManyMutationInput;
    if (typeof data.detailRich === 'string') {
      data.detailRich = sanitizeRichHtml(data.detailRich);
    }
    // 版本自增并入同一条更新语句
    data.version = { increment: 1 };

    // 条件更新：WHERE version 不匹配则计数为 0
    const { count } = await this.prisma.course.updateMany({
      where: { id: courseId, version: dto.version },
      data,
    });
    if (count === 0) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    await recordAudit(this.audit, context, {
      action: 'course.update',
      targetType: 'course',
      targetId: courseId,
      before: course,
      after: data,
    });

    return this.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  }

  // 发布/重新发布：仅草稿与已下架可执行
  async publish(courseId: number, context?: AuditContext): Promise<Course> {
    // 当前课程
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }
    if (course.status === 'published') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '课程已发布，无需重复发布',
        422,
      );
    }

    // 无章节课程不可发布：学员无内容可学
    const chapterCount = await this.prisma.chapter.count({
      where: { courseId },
    });
    if (chapterCount === 0) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '课程至少需要 1 个章节才能发布',
        422,
      );
    }

    // 条件更新计数
    const { count } = await this.prisma.course.updateMany({
      where: { id: courseId, status: { in: ['draft', 'unpublished'] } },
      data: { status: 'published', version: { increment: 1 } },
    });
    if (count === 0) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    await recordAudit(this.audit, context, {
      action: 'course.publish',
      targetType: 'course',
      targetId: courseId,
      before: { status: course.status },
      after: { status: 'published' },
    });

    return this.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  }

  // 下架：仅已发布可执行；openapi 无请求体，可选按 version 条件更新
  async unpublish(
    courseId: number,
    version?: number,
    context?: AuditContext,
  ): Promise<Course> {
    // 当前课程
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }
    if (course.status !== 'published') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '仅已发布课程可下架',
        422,
      );
    }

    // 条件更新计数
    const { count } = await this.prisma.course.updateMany({
      where: {
        id: courseId,
        status: 'published',
        ...(version === undefined ? {} : { version }),
      },
      data: { status: 'unpublished', version: { increment: 1 } },
    });
    if (count === 0) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    await recordAudit(this.audit, context, {
      action: 'course.unpublish',
      targetType: 'course',
      targetId: courseId,
      before: { status: course.status },
      after: { status: 'unpublished' },
    });

    return this.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  }

  // 设为首页推荐：仅已发布课程可标记，重复标记返回 422
  async recommend(courseId: number, context?: AuditContext): Promise<Course> {
    // 当前课程：不存在统一按 404 处理
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }
    if (course.status !== 'published') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '仅已发布的课程可设为推荐',
        422,
      );
    }
    if (course.isRecommended) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '课程已在推荐位，无需重复操作',
        422,
      );
    }

    // 条件更新：并发下已被他人标记时按冲突处理
    const { count } = await this.prisma.course.updateMany({
      where: { id: courseId, isRecommended: false },
      data: { isRecommended: true },
    });
    if (count === 0) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    await recordAudit(this.audit, context, {
      action: 'course.recommend',
      targetType: 'course',
      targetId: courseId,
      before: { isRecommended: false },
      after: { isRecommended: true },
    });

    return this.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  }

  // 取消首页推荐：仅已发布课程可操作，重复取消返回 422
  async unrecommend(courseId: number, context?: AuditContext): Promise<Course> {
    // 当前课程：不存在统一按 404 处理
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }
    if (course.status !== 'published') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '仅已发布的课程可取消推荐',
        422,
      );
    }
    if (!course.isRecommended) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '课程不在推荐位，无需重复操作',
        422,
      );
    }

    // 条件更新：并发下已被他人取消时按冲突处理
    const { count } = await this.prisma.course.updateMany({
      where: { id: courseId, isRecommended: true },
      data: { isRecommended: false },
    });
    if (count === 0) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    await recordAudit(this.audit, context, {
      action: 'course.unrecommend',
      targetType: 'course',
      targetId: courseId,
      before: { isRecommended: true },
      after: { isRecommended: false },
    });

    return this.prisma.course.findUniqueOrThrow({ where: { id: courseId } });
  }
}
