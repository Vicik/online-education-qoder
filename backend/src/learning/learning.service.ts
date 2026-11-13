import { Injectable } from '@nestjs/common';
import { CourseService } from '../catalog/course.service';
import { ErrorCode } from '../common/constants/error-codes';
import { PageQuery } from '../common/dto/page-query.dto';
import { PageResult } from '../common/dto/page-result';
import { BizException } from '../common/exceptions/biz.exception';
import { PrismaService } from '../prisma/prisma.service';

// 章节访问结果：进度百分比与是否已学完
export interface VisitResult {
  progressPercent: number; // 已访问章节数 / 总章节数（四舍五入）
  completed: boolean; // 全部章节至少访问一次
}

// 学习记录项：与 openapi StudyRecord 一致
export interface StudyRecord {
  courseId: number; // 课程 id
  courseName: string; // 课程名称
  chapterCount: number; // 课程总章节数
  visitedCount: number; // 已访问章节数
  lastChapterId: number | null; // 最近学习章节 id
  lastChapterTitle: string | null; // 最近学习章节标题
  progressPercent: number; // 学习进度百分比
  completed: boolean; // 是否已学完
  lastVisitedAt: Date; // 最后学习时间（未观看的已购课程为支付时间）
}

// 学习服务：章节访问记录、学习进度与学习记录
@Injectable()
export class LearningService {
  // 构造函数：注入 Prisma 服务与课程服务（复用购买权限判定）
  constructor(
    private readonly prisma: PrismaService,
    private readonly courseService: CourseService,
  ) {}

  // 记录章节访问并重算进度：需已购
  async recordVisit(
    userId: number,
    courseId: number,
    chapterId: number,
  ): Promise<VisitResult> {
    // 未购买（含拼团未成团）不可学习
    if (!(await this.courseService.hasPaidAccess(userId, courseId))) {
      throw new BizException(ErrorCode.NOT_PURCHASED, '请先购买课程', 403);
    }

    // 校验章节归属，防止跨课程记录进度
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, courseId },
      select: { id: true },
    });
    if (!chapter) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '章节不存在', 404);
    }

    // 课程总章节数
    const total = await this.prisma.chapter.count({ where: { courseId } });
    if (total === 0) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '章节不存在', 404);
    }

    // 首次访问插入记录，重复访问只刷新时间（复合主键幂等）
    await this.prisma.learningRecord.upsert({
      where: { userId_chapterId: { userId, chapterId } },
      create: { userId, courseId, chapterId },
      update: { visitedAt: new Date() },
    });

    // 已访问章节数（同一章节重复访问只计一次）
    const visited = await this.prisma.learningRecord.count({
      where: { userId, courseId },
    });

    return {
      progressPercent: Math.round((visited / total) * 100),
      completed: visited >= total,
    };
  }

  // 学习记录分页：已购课程 ∪ 已学习课程，按最近学习/购买时间倒序
  async getStudyRecords(
    userId: number,
    page: PageQuery,
  ): Promise<PageResult<StudyRecord>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;

    const [paidGroups, learningGroups] = await Promise.all([
      // 已购课程：已支付订单，拼团需已成团；取每门课最近支付时间
      this.prisma.order.groupBy({
        by: ['courseId'],
        where: {
          userId,
          status: 'paid',
          OR: [
            // 普通/秒杀订单：支付即授予权限
            { activityType: { not: 'groupon' } },
            // 拼团订单：团组成功成团后才授予权限
            { grouponMembers: { some: { group: { status: 'success' } } } },
          ],
        },
        _max: { paidAt: true },
      }),
      // 学习记录：按课程聚合已访问章节数与最近访问时间
      this.prisma.learningRecord.groupBy({
        by: ['courseId'],
        where: { userId },
        _max: { visitedAt: true },
        _count: { _all: true },
      }),
    ]);

    // 课程 id -> 已购时间 / 最近学习时间 / 已访问章节数
    const merged = new Map<
      number,
      { paidAt: Date | null; visitedAt: Date | null; visitedCount: number }
    >();
    // 先放入已购课程：未观看时也出现在学习记录
    for (const group of paidGroups) {
      merged.set(group.courseId, {
        paidAt: group._max.paidAt,
        visitedAt: null,
        visitedCount: 0,
      });
    }
    // 再合并学习记录：覆盖访问时间与章节数
    for (const group of learningGroups) {
      const entry = merged.get(group.courseId) ?? {
        paidAt: null,
        visitedAt: null,
        visitedCount: 0,
      };
      entry.visitedAt = group._max.visitedAt;
      entry.visitedCount = group._count._all;
      merged.set(group.courseId, entry);
    }

    // 最近活跃时间：已学习取最近学习时间，未观看取支付时间；按此倒序
    const ordered = [...merged.entries()]
      .map(([courseId, entry]) => ({
        courseId,
        ...entry,
        lastActiveAt: entry.visitedAt ?? entry.paidAt ?? new Date(0),
      }))
      .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());

    // 课程维度总条数
    const total = ordered.length;
    // 当前页课程分组
    const pageGroups = ordered.slice((pageNo - 1) * pageSize, pageNo * pageSize);
    // 当前页无数据时无需后续查询
    if (pageGroups.length === 0) {
      return { items: [], total, page: pageNo, pageSize };
    }

    // 当前页涉及的课程 id
    const courseIds = pageGroups.map((group) => group.courseId);

    const [courses, chapterTotals, latestRecords] = await Promise.all([
      // 课程名称
      this.prisma.course.findMany({
        where: { id: { in: courseIds } },
        select: { id: true, name: true },
      }),
      // 各课程章节总数
      this.prisma.chapter.groupBy({
        by: ['courseId'],
        where: { courseId: { in: courseIds } },
        _count: { _all: true },
      }),
      // 最近访问记录（按时间倒序，取每门课第一条）
      this.prisma.learningRecord.findMany({
        where: { userId, courseId: { in: courseIds } },
        orderBy: { visitedAt: 'desc' },
        select: {
          courseId: true,
          chapterId: true,
          visitedAt: true,
          chapter: { select: { title: true } },
        },
      }),
    ]);

    // 课程 id -> 课程名称
    const courseNameById = new Map(
      courses.map((course) => [course.id, course.name]),
    );
    // 课程 id -> 章节总数
    const chapterCountByCourse = new Map(
      chapterTotals.map((item) => [item.courseId, item._count._all]),
    );
    // 课程 id -> 最近访问记录（首次出现即最近）
    const latestByCourse = new Map<
      number,
      { chapterId: number; visitedAt: Date; chapterTitle: string }
    >();
    for (const record of latestRecords) {
      if (latestByCourse.has(record.courseId)) continue;
      latestByCourse.set(record.courseId, {
        chapterId: record.chapterId,
        visitedAt: record.visitedAt,
        chapterTitle: record.chapter.title,
      });
    }

    // 按分组顺序（最近活跃在前）组装学习记录
    const items = pageGroups.map((group) => {
      // 课程总章节数
      const chapterCount = chapterCountByCourse.get(group.courseId) ?? 0;
      // 已访问章节数；未观看的已购课程为 0
      const visitedCount = group.visitedCount;
      // 最近学习章节；未观看没有最近章节
      const latest = latestByCourse.get(group.courseId);

      return {
        courseId: group.courseId,
        courseName: courseNameById.get(group.courseId) ?? '',
        chapterCount,
        visitedCount,
        lastChapterId: latest?.chapterId ?? null,
        lastChapterTitle: latest?.chapterTitle ?? null,
        progressPercent:
          chapterCount > 0
            ? Math.round((visitedCount / chapterCount) * 100)
            : 0,
        completed: chapterCount > 0 && visitedCount >= chapterCount,
        lastVisitedAt: group.lastActiveAt,
      };
    });

    return { items, total, page: pageNo, pageSize };
  }
}
