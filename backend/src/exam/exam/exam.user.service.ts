import { Injectable } from '@nestjs/common';
import { Exam, ExamAttempt } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { PageQuery } from '../../common/dto/page-query.dto';
import { PageResult } from '../../common/dto/page-result';
import { BizException } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { gradeAttempt, QuestionSnapshot } from '../domain/grading';
import { SubmitAttemptDto } from '../dto/submit-attempt.dto';
import { QuestionOptionDto } from '../dto/create-question.dto';
import {
  ExamBrief,
  ExamSnapshotItem,
  toExamBrief,
  toSnapshotItems,
} from './exam.mapper';

// 用户视角题目：不含答案/解析（考试安全红线）
export interface ExamQuestionView {
  id: number; // 题目 id
  type: 'single' | 'multiple'; // 题型
  stem: string; // 题干
  options: QuestionOptionDto[]; // 选项
  score: number; // 分值
}

// 开始考试返回：题目不含答案 + 服务端权威 deadline
export interface AttemptStartData {
  attemptId: number; // 考试记录 id
  examId: number; // 考试 id
  examTitle: string; // 考试名称
  durationMin: number; // 时长（分钟）
  deadlineAt: Date; // 交卷截止时间（服务端时间）
  totalScore: number; // 总分
  passScore: number; // 及格分
  questions: ExamQuestionView[]; // 题目（不含答案/解析）
}

// 交卷返回：服务端判分结果
export interface SubmitData {
  attemptId: number; // 考试记录 id
  score: number; // 得分
  totalScore: number; // 总分
  passScore: number; // 及格分
  passed: boolean; // 是否及格
  submittedAt: Date; // 交卷时间
}

// 成绩详情中的题目：交卷后才包含用户答案、正确答案与解析
export interface AttemptResultQuestion extends ExamQuestionView {
  userAnswers: string[]; // 用户作答
  correctAnswers: string[]; // 正确答案
  analysis: string; // 答案解析
}

// 成绩与解析返回：仅在交卷后提供
export interface AttemptResultData {
  attemptId: number; // 考试记录 id
  examTitle: string; // 考试名称
  score: number; // 得分
  totalScore: number; // 总分
  passScore: number; // 及格分
  passed: boolean; // 是否及格
  submittedAt: Date; // 交卷时间
  questions: AttemptResultQuestion[]; // 逐题详情
}

// 我的考试记录项
export interface MyExamRecord {
  attemptId: number; // 考试记录 id
  examId: number; // 考试 id
  examTitle: string; // 考试名称
  score: number | null; // 得分（未交卷为 null）
  totalScore: number; // 总分
  passScore: number; // 及格分
  passed: boolean | null; // 是否及格（未交卷为 null）
  submittedAt: Date | null; // 交卷时间
}

// 判断错误是否为 Prisma 唯一约束冲突（P2002）
function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

// 快照转为判分输入：缺失答案按空数组处理，避免脏数据导致异常
function toGradingSnapshot(items: ExamSnapshotItem[]): QuestionSnapshot[] {
  return items.map((item) => ({
    ...item,
    options: item.options ?? [],
    answer: Array.isArray(item.answer) ? item.answer : [],
  }));
}

// 从快照计算总分：发布后快照即试卷的唯一事实来源
function totalFromSnapshot(items: ExamSnapshotItem[]): number {
  return items.reduce((sum, item) => sum + item.score, 0);
}

// 快照转为用户视角题目：严格剥离 answer/analysis
function toQuestionViews(items: ExamSnapshotItem[]): ExamQuestionView[] {
  return items.map((item) => ({
    id: item.questionId,
    type: item.type,
    stem: item.stem,
    options: item.options ?? [],
    score: item.score,
  }));
}

// 考试用户端服务：已发布考试、开始/交卷/成绩与超时兜底交卷
@Injectable()
export class ExamUserService {
  // 构造函数：注入数据库
  constructor(private readonly prisma: PrismaService) {}

  // 已发布考试列表（用户端）
  async listPublished(page: PageQuery): Promise<PageResult<ExamBrief>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 仅已发布可参加
    const where = { status: 'published' as const };

    // 当前页考试与总数
    const [rows, total] = await Promise.all([
      this.prisma.exam.findMany({
        where,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { publishedAt: 'desc' },
      }),
      this.prisma.exam.count({ where }),
    ]);

    return {
      items: rows.map(toExamBrief),
      total,
      page: pageNo,
      pageSize,
    };
  }

  // 考试详情（不含题目答案/解析）；未发布返回 404
  async getDetail(examId: number): Promise<ExamBrief> {
    // 当前考试
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam || exam.status !== 'published') {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '考试不存在', 404);
    }
    return toExamBrief(exam);
  }

  // 开始考试：每人每场唯一；重放返回首次 attempt；deadline 由服务端计算
  async startAttempt(
    userId: number,
    examId: number,
  ): Promise<AttemptStartData> {
    // 考试必须存在且已发布
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '考试不存在', 404);
    }
    if (exam.status !== 'published') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '考试未发布或已结束，无法开始',
        422,
      );
    }

    // 已有记录：幂等返回首次结果（含未交卷记录）
    const existing = await this.prisma.examAttempt.findUnique({
      where: { examId_userId: { examId, userId } },
    });
    if (existing) return this.toStartData(exam, existing);

    // 服务端权威截止时间：开始时间 + 考试时长
    const deadlineAt = new Date(Date.now() + exam.durationMin * 60_000);
    try {
      // 创建唯一考试记录
      const created = await this.prisma.examAttempt.create({
        data: { examId, userId, deadlineAt },
      });
      return this.toStartData(exam, created);
    } catch (error) {
      // 并发下唯一约束兜底：重查并返回先创建的那条记录
      if (!isUniqueConflict(error)) throw error;
      const first = await this.prisma.examAttempt.findUnique({
        where: { examId_userId: { examId, userId } },
      });
      if (!first) {
        throw new BizException(
          ErrorCode.INTERNAL_ERROR,
          '开始考试失败，请重试',
          500,
        );
      }
      return this.toStartData(exam, first);
    }
  }

  // 交卷：幂等；截止时间后拒绝；服务端判分并落库
  async submitAttempt(
    userId: number,
    examId: number,
    attemptId: number,
    dto: SubmitAttemptDto,
  ): Promise<SubmitData> {
    // 考试记录必须存在且属于本场考试
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt || attempt.examId !== examId) {
      throw new BizException(
        ErrorCode.RESOURCE_NOT_FOUND,
        '考试记录不存在',
        404,
      );
    }
    // 只能操作本人的考试记录
    if (attempt.userId !== userId) {
      throw new BizException(ErrorCode.FORBIDDEN, '无权操作该考试记录', 403);
    }

    // 当前考试（快照为判分依据）
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '考试不存在', 404);
    }

    // 已交卷：幂等返回首次判分结果
    if (attempt.submittedAt) {
      return this.toSubmitData(attempt, exam);
    }

    // 超过服务端 deadline 拒绝交卷（提前交卷不受影响）
    if (attempt.deadlineAt.getTime() < Date.now()) {
      throw new BizException(ErrorCode.EXAM_ENDED, '考试已结束', 422);
    }

    // 服务端判分：单选/多选均要求完全匹配，无部分分
    const snapshot = toSnapshotItems(exam);
    const { score } = gradeAttempt(toGradingSnapshot(snapshot), dto.answers);

    // 交卷时间（服务端时间）
    const submittedAt = new Date();
    // 落库得分与作答
    const updated = await this.prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        score,
        answers: dto.answers,
        submittedAt,
      },
    });

    return this.toSubmitData(updated, exam);
  }

  // 成绩与解析：未交卷返回 422；交卷后才返回答案与解析
  async getResult(
    userId: number,
    examId: number,
    attemptId: number,
  ): Promise<AttemptResultData> {
    // 考试记录必须存在且属于本场考试
    const attempt = await this.prisma.examAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt || attempt.examId !== examId) {
      throw new BizException(
        ErrorCode.RESOURCE_NOT_FOUND,
        '考试记录不存在',
        404,
      );
    }
    // 只能查看本人的考试记录
    if (attempt.userId !== userId) {
      throw new BizException(ErrorCode.FORBIDDEN, '无权查看该考试记录', 403);
    }
    // 未交卷不得查看答案与解析
    if (!attempt.submittedAt) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '考试尚未交卷，暂不可查看成绩',
        422,
      );
    }

    // 当前考试（快照为答案/解析来源）
    const exam = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '考试不存在', 404);
    }

    // 快照题目
    const snapshot = toSnapshotItems(exam);
    // 用户作答（历史脏数据按空对象处理）
    const answers = (attempt.answers ?? {}) as Record<string, string[]>;
    // 逐题合并用户答案、正确答案与解析
    const questions: AttemptResultQuestion[] = snapshot.map((item) => {
      // 用户该题作答
      const raw = answers[String(item.questionId)];
      return {
        id: item.questionId,
        type: item.type,
        stem: item.stem,
        options: item.options ?? [],
        score: item.score,
        userAnswers: Array.isArray(raw) ? raw : [],
        correctAnswers: Array.isArray(item.answer) ? item.answer : [],
        analysis: item.analysis ?? '',
      };
    });

    // 得分与总分
    const score = attempt.score ?? 0;
    const totalScore = totalFromSnapshot(snapshot);

    return {
      attemptId: attempt.id,
      examTitle: exam.title,
      score,
      totalScore,
      passScore: exam.passScore,
      passed: score >= exam.passScore,
      submittedAt: attempt.submittedAt,
      questions,
    };
  }

  // 我的考试记录：按开始时间倒序分页
  async listMine(
    userId: number,
    page: PageQuery,
  ): Promise<PageResult<MyExamRecord>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;

    // 当前页记录（含考试简要信息）与总数
    const [rows, total] = await Promise.all([
      this.prisma.examAttempt.findMany({
        where: { userId },
        include: { exam: true },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.examAttempt.count({ where: { userId } }),
    ]);

    // 映射为成绩记录（未交卷时分数/及格状态为空）
    const items: MyExamRecord[] = rows.map((attempt) => {
      // 已交卷得分
      const score = attempt.score ?? 0;
      return {
        attemptId: attempt.id,
        examId: attempt.examId,
        examTitle: attempt.exam.title,
        score: attempt.submittedAt ? score : null,
        totalScore: attempt.exam.totalScore,
        passScore: attempt.exam.passScore,
        passed: attempt.submittedAt ? score >= attempt.exam.passScore : null,
        submittedAt: attempt.submittedAt,
      };
    });

    return { items, total, page: pageNo, pageSize };
  }

  // Worker 兜底交卷：deadline 已过且未提交的记录按现有答案判分（未答计 0）
  async autoSubmitExpired(now: Date): Promise<number> {
    // 所有已超时且未交卷的记录
    const expired = await this.prisma.examAttempt.findMany({
      where: { submittedAt: null, deadlineAt: { lt: now } },
      include: { exam: true },
    });

    // 实际处理的记录数
    let processed = 0;
    for (const attempt of expired) {
      // 快照题目
      const snapshot = toSnapshotItems(attempt.exam);
      // 用户已保存的答案（未作答按空对象）
      const answers = (attempt.answers ?? {}) as Record<string, string[]>;
      // 判分（未答题计 0 分）
      const { score } = gradeAttempt(toGradingSnapshot(snapshot), answers);
      // 条件更新：并发下已被用户交卷则跳过，保证幂等
      const { count } = await this.prisma.examAttempt.updateMany({
        where: { id: attempt.id, submittedAt: null },
        data: { score, submittedAt: now },
      });
      if (count > 0) processed += 1;
    }
    return processed;
  }

  // 组装开始考试返回：剥离答案/解析
  private toStartData(exam: Exam, attempt: ExamAttempt): AttemptStartData {
    return {
      attemptId: attempt.id,
      examId: exam.id,
      examTitle: exam.title,
      durationMin: exam.durationMin,
      deadlineAt: attempt.deadlineAt,
      totalScore: exam.totalScore,
      passScore: exam.passScore,
      questions: toQuestionViews(toSnapshotItems(exam)),
    };
  }

  // 组装交卷返回：以快照总分与及格分为准
  private toSubmitData(attempt: ExamAttempt, exam: Exam): SubmitData {
    // 快照总分
    const totalScore = totalFromSnapshot(toSnapshotItems(exam));
    // 得分（历史数据兜底为 0）
    const score = attempt.score ?? 0;
    return {
      attemptId: attempt.id,
      score,
      totalScore,
      passScore: exam.passScore,
      passed: score >= exam.passScore,
      submittedAt: attempt.submittedAt ?? new Date(),
    };
  }
}
