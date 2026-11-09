import { Exam, ExamStatus, Prisma } from '@prisma/client';
import { QuestionOptionDto } from '../dto/create-question.dto';

// 发布后的题目快照项：含答案与解析，仅供服务端判分与交卷后解析
export interface ExamSnapshotItem {
  questionId: number; // 题库题目 id
  type: 'single' | 'multiple'; // 题型
  stem: string; // 题干
  options: QuestionOptionDto[]; // 选项
  score: number; // 分值
  sortOrder: number; // 组卷顺序
  answer: string[]; // 正确答案
  analysis: string; // 答案解析
}

// 草稿期快照项：只存组卷信息，不存答案/解析（发布时再合并）
export type DraftExamSnapshotItem = Omit<
  ExamSnapshotItem,
  'answer' | 'analysis'
>;

// 考试简要信息：用户端与管理端列表共用，不含题目内容
export interface ExamBrief {
  id: number; // 考试 id
  title: string; // 考试名称
  description: string; // 考试说明
  durationMin: number; // 时长（分钟）
  passScore: number; // 及格分
  totalScore: number; // 总分
  questionCount: number; // 题目数量
  status: ExamStatus; // 草稿/已发布/已结束
  publishedAt: Date | null; // 发布时间
}

// 管理端考试详情：在简要信息上补充可编辑所需字段
export interface ExamAdminView extends ExamBrief {
  version: number; // 乐观锁版本
  questionIds: number[]; // 组卷题目 id（按顺序）
}

// 将 JSON 快照安全解析为数组
function parseSnapshot(value: Prisma.JsonValue): unknown[] {
  // 非数组数据一律视为空快照
  return Array.isArray(value) ? value : [];
}

// 考试行转为简要信息
export function toExamBrief(exam: Exam): ExamBrief {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    durationMin: exam.durationMin,
    passScore: exam.passScore,
    totalScore: exam.totalScore,
    questionCount: parseSnapshot(exam.snapshot).length,
    status: exam.status,
    publishedAt: exam.publishedAt,
  };
}

// 提取快照中的题目 id（按组卷顺序）
export function toQuestionIds(exam: Exam): number[] {
  return parseSnapshot(exam.snapshot).map(
    (item) => (item as { questionId: number }).questionId,
  );
}

// 考试行转为管理端详情
export function toExamAdminView(exam: Exam): ExamAdminView {
  return {
    ...toExamBrief(exam),
    version: exam.version,
    questionIds: toQuestionIds(exam),
  };
}

// 将快照数组转为发布后的强类型快照（供判分使用）
export function toSnapshotItems(exam: Exam): ExamSnapshotItem[] {
  return parseSnapshot(exam.snapshot) as unknown as ExamSnapshotItem[];
}
