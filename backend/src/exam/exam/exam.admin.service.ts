import { Injectable } from '@nestjs/common';
import { Prisma, Question } from '@prisma/client';
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
import { QuestionOptionDto } from '../dto/create-question.dto';
import { CreateExamDto } from '../dto/create-exam.dto';
import { UpdateExamDto } from '../dto/update-exam.dto';
import {
  DraftExamSnapshotItem,
  ExamAdminView,
  ExamBrief,
  ExamSnapshotItem,
  toExamAdminView,
  toExamBrief,
} from './exam.mapper';

// 乐观锁冲突提示：与其他管理端模块保持一致
const VERSION_CONFLICT_MESSAGE = '数据已被修改，请刷新后重试';

// 将 JSON 快照安全解析为草稿快照数组
function parseDraftSnapshot(value: Prisma.JsonValue): DraftExamSnapshotItem[] {
  // 非数组数据一律视为空快照
  return Array.isArray(value)
    ? (value as unknown as DraftExamSnapshotItem[])
    : [];
}

// 由题库题目构建草稿快照：按组卷顺序写入，不含答案/解析
function buildDraftSnapshot(questions: Question[]): DraftExamSnapshotItem[] {
  return questions.map((question, index) => ({
    questionId: question.id,
    type: question.type,
    stem: question.stem,
    options: question.options as unknown as QuestionOptionDto[],
    score: question.score,
    sortOrder: index + 1,
  }));
}

// 计算试卷总分
function sumScore(snapshot: Array<{ score: number }>): number {
  return snapshot.reduce((sum, item) => sum + item.score, 0);
}

// 校验及格分：大于 0 且不超过总分
function assertPassScore(passScore: number, totalScore: number): void {
  if (
    !Number.isInteger(passScore) ||
    passScore <= 0 ||
    passScore > totalScore
  ) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      `及格分须大于 0 且不超过总分 ${totalScore}`,
      422,
    );
  }
}

// 考试管理端服务：组卷、编辑（仅草稿）、发布冻结快照与结束
@Injectable()
export class ExamAdminService {
  // 构造函数：注入数据库与审计服务
  constructor(
    private readonly prisma: PrismaService, // 数据库访问
    private readonly audit: AuditService, // 管理端操作留痕
  ) {}

  // 管理端考试列表：全状态按创建时间倒序分页
  async list(page: PageQuery): Promise<PageResult<ExamBrief>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;

    // 当前页考试与总数
    const [rows, total] = await Promise.all([
      this.prisma.exam.findMany({
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.exam.count(),
    ]);

    return {
      items: rows.map(toExamBrief),
      total,
      page: pageNo,
      pageSize,
    };
  }

  // 创建考试：按题目顺序落草稿快照，总分=题目分值之和
  async create(
    dto: CreateExamDto,
    context?: AuditContext,
  ): Promise<ExamAdminView> {
    // 校验题目可用性并按顺序取回
    const questions = await this.loadQuestions(dto.questionIds);
    // 草稿快照（不含答案/解析）
    const snapshot = buildDraftSnapshot(questions);
    // 试卷总分
    const totalScore = sumScore(snapshot);
    // 及格分不得超总分
    assertPassScore(dto.passScore, totalScore);

    // 创建草稿考试
    const created = await this.prisma.exam.create({
      data: {
        title: dto.title,
        description: dto.description ?? '',
        durationMin: dto.durationMin,
        passScore: dto.passScore,
        totalScore,
        status: 'draft',
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    await recordAudit(this.audit, context, {
      action: 'exam.create',
      targetType: 'exam',
      targetId: created.id,
      after: created,
    });

    return toExamAdminView(created);
  }

  // 管理端考试详情：含组卷题目 id 与顺序（不含答案/解析）
  async getDetail(examId: number): Promise<ExamAdminView> {
    // 当前考试
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '考试不存在', 404);
    }
    return toExamAdminView(exam);
  }

  // 编辑考试：仅草稿；version 乐观锁；可重新组卷并重算总分
  async update(
    examId: number,
    dto: UpdateExamDto,
    context?: AuditContext,
  ): Promise<ExamAdminView> {
    // 当前考试
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '考试不存在', 404);
    }
    if (exam.status !== 'draft') {
      throw new BizException(ErrorCode.PARAM_INVALID, '仅草稿考试可编辑', 422);
    }
    // 明显过期的请求直接拒绝
    if (dto.version !== exam.version) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    // 修改后的草稿快照：未重新组卷时保持原题序
    let snapshot = parseDraftSnapshot(exam.snapshot);
    // 修改后的总分
    let totalScore = exam.totalScore;
    if (dto.questionIds !== undefined) {
      // 按新选题重建快照并重算总分
      const questions = await this.loadQuestions(dto.questionIds);
      snapshot = buildDraftSnapshot(questions);
      totalScore = sumScore(snapshot);
    }

    // 修改后的及格分
    const passScore = dto.passScore ?? exam.passScore;
    // 及格分不得超总分
    assertPassScore(passScore, totalScore);

    // 更新字段：只收集显式传入的字段
    const data: Prisma.ExamUpdateManyMutationInput = {
      version: { increment: 1 },
      passScore,
      totalScore,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      ...(dto.title === undefined ? {} : { title: dto.title }),
      ...(dto.description === undefined
        ? {}
        : { description: dto.description }),
      ...(dto.durationMin === undefined
        ? {}
        : { durationMin: dto.durationMin }),
    };

    // 条件更新：版本在读取后被他人修改则计数为 0
    const { count } = await this.prisma.exam.updateMany({
      where: { id: examId, version: dto.version },
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
      action: 'exam.update',
      targetType: 'exam',
      targetId: examId,
      before: exam,
      after: data,
    });

    // 返回更新后的完整考试
    const updated = await this.prisma.exam.findUniqueOrThrow({
      where: { id: examId },
    });
    return toExamAdminView(updated);
  }

  // 发布考试：读取题库当前内容合并答案/解析，冻结为快照
  async publish(
    examId: number,
    context?: AuditContext,
  ): Promise<ExamAdminView> {
    // 当前考试
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '考试不存在', 404);
    }
    if (exam.status !== 'draft') {
      throw new BizException(ErrorCode.PARAM_INVALID, '仅草稿考试可发布', 422);
    }

    // 草稿快照（含题目顺序）
    const draft = parseDraftSnapshot(exam.snapshot);
    if (draft.length === 0) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '考试至少需要 1 道题',
        422,
      );
    }

    // 发布时重新读取题库：确保题目仍存在且启用
    const questions = await this.loadQuestions(
      draft.map((item) => item.questionId),
    );
    // 题库题目按 id 索引
    const byId = new Map(questions.map((question) => [question.id, question]));
    // 合并完整快照：值拷贝题目内容，发布后题库修改不影响本考试
    const merged: ExamSnapshotItem[] = draft.map((item, index) => {
      // 对应题库题目（loadQuestions 已保证存在）
      const question = byId.get(item.questionId)!;
      return {
        questionId: question.id,
        type: question.type,
        stem: question.stem,
        options: question.options as unknown as QuestionOptionDto[],
        score: question.score,
        sortOrder: item.sortOrder ?? index + 1,
        answer: question.answer as unknown as string[],
        analysis: question.analysis,
      };
    });
    // 发布时按题目当前分值重算总分（分值创建后不可改，正常与草稿一致）
    const totalScore = sumScore(merged);
    // 及格分不得超总分
    assertPassScore(exam.passScore, totalScore);

    // 发布时间（服务端时间）
    const publishedAt = new Date();
    // 冻结快照并置为已发布
    const updated = await this.prisma.exam.update({
      where: { id: examId },
      data: {
        snapshot: merged as unknown as Prisma.InputJsonValue,
        status: 'published',
        publishedAt,
        totalScore,
        version: { increment: 1 },
      },
    });

    await recordAudit(this.audit, context, {
      action: 'exam.publish',
      targetType: 'exam',
      targetId: examId,
      before: { status: exam.status },
      after: { status: 'published', publishedAt },
    });

    return toExamAdminView(updated);
  }

  // 结束考试：仅已发布可结束；已开始的 attempt 仍可在 deadline 前交卷
  async end(examId: number, context?: AuditContext): Promise<ExamAdminView> {
    // 当前考试
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '考试不存在', 404);
    }
    if (exam.status !== 'published') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '仅已发布考试可结束',
        422,
      );
    }

    // 状态流转
    const updated = await this.prisma.exam.update({
      where: { id: examId },
      data: { status: 'ended', version: { increment: 1 } },
    });

    await recordAudit(this.audit, context, {
      action: 'exam.end',
      targetType: 'exam',
      targetId: examId,
      before: { status: exam.status },
      after: { status: 'ended' },
    });

    return toExamAdminView(updated);
  }

  // 按给定顺序取回可用题目：至少 1 道、不可重复、必须存在且启用
  private async loadQuestions(questionIds: number[]): Promise<Question[]> {
    // 空试卷无法满足及格分 >0 的约束
    if (questionIds.length === 0) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '考试至少需要 1 道题',
        422,
      );
    }
    // 同一题不可重复组卷
    if (new Set(questionIds).size !== questionIds.length) {
      throw new BizException(ErrorCode.PARAM_INVALID, '题目不可重复', 422);
    }

    // 仅取启用状态的题目
    const rows = await this.prisma.question.findMany({
      where: { id: { in: questionIds }, status: 'enabled' },
    });
    // 题目 id 索引
    const byId = new Map(rows.map((row) => [row.id, row]));
    // 不存在或已停用的题目
    const missing = questionIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        `题目不存在或已停用：${missing.join(',')}`,
        422,
      );
    }

    // 按请求顺序返回题目
    return questionIds.map((id) => byId.get(id)!);
  }
}
