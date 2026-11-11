import type {
  AdminExamDetail,
  AdminQuestion,
  ExamCreateInput,
  ExamUpdateInput,
} from '@/api/types';

// 考试表单值
export interface ExamFormValues {
  title: string;
  description?: string;
  durationMin: number;
  passScore: number;
  questionIds: number[];
}

// 按出题顺序计算总分
export function totalScoreOf(
  questions: AdminQuestion[],
  questionIds: number[],
): number {
  // 题目 id → 分值
  const scoreById = new Map<number, number>();
  questions.forEach((question) => {
    scoreById.set(question.id ?? 0, question.score ?? 0);
  });
  return questionIds.reduce((sum, id) => sum + (scoreById.get(id) ?? 0), 0);
}

// 创建载荷：按选择顺序提交题目 id
export function toExamCreatePayload(values: ExamFormValues): ExamCreateInput {
  return {
    title: values.title.trim(),
    description: values.description?.trim() ?? '',
    durationMin: values.durationMin,
    passScore: values.passScore,
    questionIds: values.questionIds,
  };
}

// 编辑载荷：携带 version
export function toExamUpdatePayload(
  values: ExamFormValues,
  version: number,
): ExamUpdateInput {
  return {
    version,
    title: values.title.trim(),
    description: values.description?.trim() ?? '',
    durationMin: values.durationMin,
    passScore: values.passScore,
    questionIds: values.questionIds,
  };
}

// 详情 → 表单值
export function toExamFormValues(exam: AdminExamDetail): ExamFormValues {
  return {
    title: exam.title ?? '',
    description: exam.description ?? '',
    durationMin: exam.durationMin ?? 60,
    passScore: exam.passScore ?? 1,
    questionIds: exam.questionIds ?? [],
  };
}
