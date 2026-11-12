import { Injectable } from '@nestjs/common';
import {
  CourseStatus,
  CourseType,
  CouponTemplateStatus,
  FlashSaleActivityStatus,
  GrouponActivityStatus,
} from '@prisma/client';
import { ErrorCode } from '../common/constants/error-codes';
import { PageQuery } from '../common/dto/page-query.dto';
import { PageResult } from '../common/dto/page-result';
import { BizException } from '../common/exceptions/biz.exception';
import { isStorageKey } from '../common/utils/media.util';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

// 首页推荐课程数量
const RECOMMENDATION_LIMIT = 8;

// 课程简要信息：与 openapi CourseBrief 一致
export interface CourseBrief {
  id: number; // 课程 id
  name: string; // 课程名称
  type: CourseType; // 课程类型
  coverKey: string | null; // 封面对象存储 key（历史 http 数据为 null）
  coverUrl: string | null; // 封面展示地址（key 为签名 URL，历史 http 原样）
  instructor: string | null; // 讲师
  originalCents: number; // 原价（分）
  saleCents: number; // 售价（分）
  status: CourseStatus; // 课程状态
}

// 课程查询行：不含派生字段 coverKey
export type CourseBriefRow = Omit<CourseBrief, 'coverKey'>;

// 章节目录项：不含正文
export interface ChapterBrief {
  id: number; // 章节 id
  title: string; // 章节标题
  contentType: CourseType; // 章节内容类型
  sortOrder: number; // 章节序号
}

// 拼团活动简要信息：与 openapi GrouponActivityBrief 一致
export interface GrouponActivityBrief {
  id: number; // 活动 id
  courseId: number; // 关联课程 id
  courseName: string; // 关联课程名称
  name: string; // 活动名称
  priceCents: number; // 拼团价（分）
  targetSize: number; // 成团人数
  startAt: Date; // 开始时间
  endAt: Date; // 结束时间
  status: GrouponActivityStatus; // 活动状态
}

// 秒杀活动简要信息：与 openapi FlashSaleActivityBrief 一致
export interface FlashSaleActivityBrief {
  id: number; // 活动 id
  courseId: number; // 关联课程 id
  courseName: string; // 关联课程名称
  name: string; // 活动名称
  priceCents: number; // 秒杀价（分）
  stock: number; // 库存
  sold: number; // 已售
  startAt: Date; // 开始时间
  endAt: Date; // 结束时间
  status: FlashSaleActivityStatus; // 活动状态
}

// 可领取券模板简要信息：与 openapi CouponTemplateBrief 一致
export interface CouponTemplateBrief {
  id: number; // 模板 id
  name: string; // 券名称
  discountCents: number; // 抵扣面额（分）
  startAt: Date; // 生效时间
  endAt: Date; // 失效时间
  totalQty: number; // 发放总量
  claimedCount: number; // 已领取数量
  status: CouponTemplateStatus; // 模板状态
  courseIds: number[]; // 适用课程 id
}

// 章节正文：与 openapi ChapterContent 一致
export interface ChapterContent {
  id: number; // 章节 id
  title: string; // 章节标题
  contentType: CourseType; // 内容类型
  content: string | null; // 正文（rich HTML / 对象存储 key）
  sortOrder: number; // 章节序号
}

// 课程详情：基础信息 + 活动 + 可领券 + 章节目录
export interface CourseDetail extends CourseBrief {
  version: number; // 乐观锁版本：管理端编辑回传，用户端忽略
  intro: string | null; // 课程简介
  detailRich: string | null; // 课程详情富文本
  chapters: ChapterBrief[]; // 章节目录（不含正文）
  groupon: GrouponActivityBrief | null; // 进行中的拼团活动
  flashSale: FlashSaleActivityBrief | null; // 进行中的秒杀活动
  claimableCoupons: CouponTemplateBrief[]; // 当前可领取的券
}

// 课程简要信息查询字段（用户端通用）
export const COURSE_BRIEF_SELECT = {
  id: true,
  name: true,
  type: true,
  coverUrl: true,
  instructor: true,
  originalCents: true,
  saleCents: true,
  status: true,
} as const;

// 章节目录查询字段：不查询正文 content
const CHAPTER_BRIEF_SELECT = {
  id: true,
  title: true,
  contentType: true,
  sortOrder: true,
} as const;

// 将查询结果映射为课程简要信息：coverKey 保留原始 key，coverUrl 读取时签名
export async function toCourseBrief(
  course: CourseBriefRow,
  storage: StorageService,
): Promise<CourseBrief> {
  return {
    id: course.id,
    name: course.name,
    type: course.type,
    coverKey: isStorageKey(course.coverUrl) ? course.coverUrl : null,
    coverUrl: await storage.resolveUrl(course.coverUrl),
    instructor: course.instructor,
    originalCents: course.originalCents,
    saleCents: course.saleCents,
    status: course.status,
  };
}

// 课程服务：用户端课程浏览与学习权限判定
@Injectable()
export class CourseService {
  // 构造函数：注入 Prisma 与对象存储签名服务
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // 已发布课程分页列表
  async listPublished(page: PageQuery): Promise<PageResult<CourseBrief>> {
    // 分页参数兜底（直接调用服务时可能未经过 ValidationPipe）
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 只看已发布课程
    const where = { status: 'published' as const };

    const [rows, total] = await Promise.all([
      // 当前页课程
      this.prisma.course.findMany({
        where,
        select: COURSE_BRIEF_SELECT,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      // 总数
      this.prisma.course.count({ where }),
    ]);

    return {
      items: await Promise.all(
        rows.map((row) => toCourseBrief(row, this.storage)),
      ),
      total,
      page: pageNo,
      pageSize,
    };
  }

  // 首页推荐：最近发布的已发布课程
  async listRecommendations(): Promise<CourseBrief[]> {
    const rows = await this.prisma.course.findMany({
      where: { status: 'published' },
      select: COURSE_BRIEF_SELECT,
      take: RECOMMENDATION_LIMIT,
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((row) => toCourseBrief(row, this.storage)));
  }

  // 课程详情：默认仅已发布课程；管理端传 includeUnpublished=true 可查看草稿/下架
  async getDetail(
    courseId: number,
    includeUnpublished = false,
  ): Promise<CourseDetail> {
    // 课程基础信息（游客视角只允许已发布课程）
    const course = await this.prisma.course.findFirst({
      where: {
        id: courseId,
        ...(includeUnpublished ? {} : { status: 'published' as const }),
      },
    });
    // 不存在或未发布统一按不存在处理
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }

    // 服务端当前时间：用于过滤进行中活动与有效期内的券
    const now = new Date();

    const [chapters, groupon, flashSale, coupons] = await Promise.all([
      // 章节目录：仅名称与类型，不返回正文
      this.prisma.chapter.findMany({
        where: { courseId },
        select: CHAPTER_BRIEF_SELECT,
        orderBy: { sortOrder: 'asc' },
      }),
      // 进行中的拼团活动
      this.prisma.grouponActivity.findFirst({
        where: {
          courseId,
          status: 'ongoing',
          endAt: { gt: now },
        },
        orderBy: { startAt: 'desc' },
      }),
      // 进行中的秒杀活动
      this.prisma.flashSaleActivity.findFirst({
        where: {
          courseId,
          status: 'ongoing',
          endAt: { gt: now },
        },
        orderBy: { startAt: 'desc' },
      }),
      // 可领券：启用且在有效期内、适用于本课程的模板
      this.prisma.couponTemplate.findMany({
        where: {
          status: 'enabled',
          startAt: { lte: now },
          endAt: { gte: now },
          courses: { some: { courseId } },
        },
        select: {
          id: true,
          name: true,
          discountCents: true,
          startAt: true,
          endAt: true,
          totalQty: true,
          claimedCount: true,
          status: true,
          courses: { select: { courseId: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      ...(await toCourseBrief(course, this.storage)),
      version: course.version,
      intro: course.intro,
      // 富文本图片读取时重写为签名地址
      detailRich:
        course.detailRich === null
          ? null
          : await this.storage.resolveRichHtml(course.detailRich),
      chapters,
      // 活动信息补充课程名称（前端直接展示）
      groupon: groupon
        ? {
            id: groupon.id,
            courseId: groupon.courseId,
            courseName: course.name,
            name: groupon.name,
            priceCents: groupon.priceCents,
            targetSize: groupon.targetSize,
            startAt: groupon.startAt,
            endAt: groupon.endAt,
            status: groupon.status,
          }
        : null,
      flashSale: flashSale
        ? {
            id: flashSale.id,
            courseId: flashSale.courseId,
            courseName: course.name,
            name: flashSale.name,
            priceCents: flashSale.priceCents,
            stock: flashSale.stock,
            sold: flashSale.sold,
            startAt: flashSale.startAt,
            endAt: flashSale.endAt,
            status: flashSale.status,
          }
        : null,
      // 券模板关联课程转为 courseIds
      claimableCoupons: coupons.map(({ courses, ...template }) => ({
        ...template,
        courseIds: courses.map((item) => item.courseId),
      })),
    };
  }

  // 学习权限判定：已支付订单，且非拼团或拼团团组已成功成团
  async hasPaidAccess(userId: number, courseId: number): Promise<boolean> {
    // 查找满足权限条件的已支付订单
    const order = await this.prisma.order.findFirst({
      where: {
        userId,
        courseId,
        status: 'paid',
        OR: [
          // 普通/秒杀订单：支付即授予权限
          { activityType: { not: 'groupon' } },
          // 拼团订单：团组成功成团后才授予权限
          { grouponMembers: { some: { group: { status: 'success' } } } },
        ],
      },
    });
    return order !== null;
  }

  // 章节正文：需已购买；下架课程的已购用户仍可访问
  async getChapterContent(
    userId: number,
    courseId: number,
    chapterId: number,
  ): Promise<ChapterContent> {
    // 先校验购买权限，避免未购用户探测章节是否存在
    if (!(await this.hasPaidAccess(userId, courseId))) {
      throw new BizException(ErrorCode.NOT_PURCHASED, '请先购买课程', 403);
    }

    // 校验章节归属，防止跨课程读取正文
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, courseId },
    });
    // 章节不存在
    if (!chapter) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '章节不存在', 404);
    }

    // 正文按类型解析：富文本签名图片，视频/音频 key 换签名地址，历史 http 原样
    const content =
      chapter.content === null
        ? null
        : chapter.contentType === 'rich'
          ? await this.storage.resolveRichHtml(chapter.content)
          : await this.storage.resolveUrl(chapter.content);

    return {
      id: chapter.id,
      title: chapter.title,
      contentType: chapter.contentType,
      content,
      sortOrder: chapter.sortOrder,
    };
  }
}
