import { Injectable } from '@nestjs/common';
import { Chapter, Course, CourseType } from '@prisma/client';
import {
  AuditContext,
  AuditService,
  recordAudit,
} from '../audit/audit.service';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { sanitizeRichHtml } from '../common/utils/sanitize.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { ReorderChaptersDto } from './dto/reorder-chapters.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';

// 章节标题最大字符数
const TITLE_MAX_LENGTH = 60;

// 章节目录项：用于审计与返回
interface ChapterBriefRow {
  id: number; // 章节 id
  title: string; // 章节标题
  contentType: CourseType; // 内容类型
  sortOrder: number; // 序号
}

// 章节管理服务：增删改、类型锁定与两阶段重编号
@Injectable()
export class ChapterAdminService {
  // 构造函数：注入 Prisma 与审计服务
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // 新增章节
  async addChapter(
    courseId: number,
    dto: CreateChapterDto,
    context?: AuditContext,
  ): Promise<Chapter> {
    // 课程（必须处于可编辑状态）
    const course = await this.requireEditableCourse(courseId);

    // 章节类型必须与课程类型一致（保存首个章节后锁定）
    if (dto.contentType !== course.type) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '章节类型必须与课程类型一致',
        422,
      );
    }
    // 服务层兜底标题长度校验
    if (dto.title.length > TITLE_MAX_LENGTH) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        `章节标题最多 ${TITLE_MAX_LENGTH} 个字符`,
        400,
      );
    }

    // 当前最大序号
    const aggregate = await this.prisma.chapter.aggregate({
      where: { courseId },
      _max: { sortOrder: true },
    });
    // 新章节追加到末尾
    const sortOrder = (aggregate._max.sortOrder ?? 0) + 1;

    // 落库新章节
    const created = await this.prisma.chapter.create({
      data: {
        courseId,
        title: dto.title,
        contentType: dto.contentType,
        content: this.prepareContent(course.type, dto.content),
        sortOrder,
      },
    });

    await recordAudit(this.audit, context, {
      action: 'chapter.create',
      targetType: 'chapter',
      targetId: created.id,
      after: created,
    });

    return created;
  }

  // 编辑章节：类型继承课程不可改
  async updateChapter(
    courseId: number,
    chapterId: number,
    dto: UpdateChapterDto,
    context?: AuditContext,
  ): Promise<Chapter> {
    // 课程与目标章节
    const course = await this.requireEditableCourse(courseId);
    const chapter = await this.requireChapter(courseId, chapterId);

    if (dto.title !== undefined && dto.title.length > TITLE_MAX_LENGTH) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        `章节标题最多 ${TITLE_MAX_LENGTH} 个字符`,
        400,
      );
    }

    // 更新章节
    const updated = await this.prisma.chapter.update({
      where: { id: chapterId },
      data: {
        ...(dto.title === undefined ? {} : { title: dto.title }),
        ...(dto.content === undefined
          ? {}
          : { content: this.prepareContent(course.type, dto.content) }),
      },
    });

    await recordAudit(this.audit, context, {
      action: 'chapter.update',
      targetType: 'chapter',
      targetId: chapterId,
      before: chapter,
      after: updated,
    });

    return updated;
  }

  // 删除章节：删除后从 1 连续重编号
  async deleteChapter(
    courseId: number,
    chapterId: number,
    context?: AuditContext,
  ): Promise<void> {
    await this.requireEditableCourse(courseId);
    await this.requireChapter(courseId, chapterId);

    // 删除前章节列表（审计快照）
    const before = await this.listChapters(courseId);

    await this.prisma.chapter.delete({ where: { id: chapterId } });

    // 剩余章节按原顺序重编号
    const remaining = await this.listChapters(courseId);
    await this.renumber(
      courseId,
      remaining.map((chapter) => chapter.id),
    );

    // 删除后章节列表（审计快照）
    const after = await this.listChapters(courseId);

    await recordAudit(this.audit, context, {
      action: 'chapter.delete',
      targetType: 'chapter',
      targetId: chapterId,
      before: { chapters: before },
      after: { chapters: after },
    });
  }

  // 章节排序：两阶段重编号，最终 1..n 连续
  async reorderChapters(
    courseId: number,
    dto: ReorderChaptersDto,
    context?: AuditContext,
  ): Promise<ChapterBriefRow[]> {
    await this.requireEditableCourse(courseId);

    // 现有章节（排序前的顺序即审计快照）
    const before = await this.listChapters(courseId);
    // 现有章节 id 集合
    const existingIds = new Set(before.map((chapter) => chapter.id));
    // 请求顺序
    const orderedIds = dto.orderedChapterIds;
    // 去重后的请求 id 数量
    const uniqueCount = new Set(orderedIds).size;

    // 缺项/多项/重复均拒绝
    if (
      uniqueCount !== orderedIds.length ||
      orderedIds.length !== existingIds.size ||
      orderedIds.some((id) => !existingIds.has(id))
    ) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '排序列表必须包含课程的全部章节且不能重复',
        400,
      );
    }

    await this.renumber(courseId, orderedIds);

    // 排序后的章节列表
    const after = await this.listChapters(courseId);

    await recordAudit(this.audit, context, {
      action: 'chapter.reorder',
      targetType: 'course',
      targetId: courseId,
      before: { chapters: before },
      after: { chapters: after },
    });

    return after;
  }

  // 校验课程存在且处于草稿/已下架（已发布需先下架）
  private async requireEditableCourse(
    courseId: number,
  ): Promise<Pick<Course, 'id' | 'type' | 'status'>> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
    });
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }
    if (course.status === 'published') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '课程已发布，请先下架后再维护章节',
        422,
      );
    }
    return course;
  }

  // 校验章节存在且属于该课程
  private async requireChapter(
    courseId: number,
    chapterId: number,
  ): Promise<Chapter> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, courseId },
    });
    if (!chapter) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '章节不存在', 404);
    }
    return chapter;
  }

  // 按课程类型准备章节正文：图文内容需净化
  private prepareContent(
    courseType: CourseType,
    content: string | null | undefined,
  ): string | null {
    // 非图文类型内容为对象存储 key，原样保存
    if (courseType !== 'rich') return content ?? null;
    // 图文类型净化 HTML；空值保持 null
    return content ? sanitizeRichHtml(content) : null;
  }

  // 查询章节目录（不含正文）
  private async listChapters(courseId: number): Promise<ChapterBriefRow[]> {
    return this.prisma.chapter.findMany({
      where: { courseId },
      select: {
        id: true,
        title: true,
        contentType: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // 两阶段重编号：先全量加偏移避开唯一约束，再按目标顺序置 1..n
  private async renumber(
    courseId: number,
    orderedIds: number[],
  ): Promise<void> {
    // 第一阶段：整体加 1000，腾空 1..n
    await this.prisma.chapter.updateMany({
      where: { courseId },
      data: { sortOrder: { increment: 1000 } },
    });
    // 第二阶段：按目标顺序逐条写入连续序号
    // 逐条写入目标序号（从 1 开始）
    for (let index = 0; index < orderedIds.length; index += 1) {
      await this.prisma.chapter.update({
        where: { id: orderedIds[index] },
        data: { sortOrder: index + 1 },
      });
    }
  }
}
