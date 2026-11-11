import type {
  AdminQuestion,
  AdminQuestionType,
  QuestionCreateInput,
  QuestionUpdateInput,
} from '@/api/types';

// 选项表单值
export interface QuestionOptionValue {
  key: string;
  text: string;
}

// 题目表单值
export interface QuestionFormValues {
  type: AdminQuestionType;
  stem: string;
  options: QuestionOptionValue[];
  answer: string[];
  score: number;
  analysis: string;
}

// 界面固定使用的选项 key 序列
const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

// 取下一个未占用的选项 key；已满则回退 A（按钮同时禁用）
export function nextOptionKey(options: QuestionOptionValue[]): string {
  // 当前已占用 key
  const used = new Set(options.map((option) => option.key));
  return OPTION_KEYS.find((key) => !used.has(key)) ?? 'A';
}

// 选项 → 答案选择项：标签带 key，便于用户与测试定位
export function buildAnswerOptions(options: QuestionOptionValue[]) {
  return options.map((option) => ({
    value: option.key,
    label: `${option.key}. ${option.text}`,
  }));
}

// 创建载荷：去首尾空白；分值只在创建时提交
export function toQuestionCreatePayload(
  values: QuestionFormValues,
): QuestionCreateInput {
  return {
    type: values.type,
    stem: values.stem.trim(),
    options: values.options.map((option) => ({
      key: option.key,
      text: option.text.trim(),
    })),
    answer: values.answer,
    analysis: values.analysis.trim(),
    score: values.score,
  };
}

// 编辑载荷：携带 version；不提交 score（服务端也会忽略）
export function toQuestionUpdatePayload(
  values: QuestionFormValues,
  version: number,
): QuestionUpdateInput {
  return {
    version,
    type: values.type,
    stem: values.stem.trim(),
    options: values.options.map((option) => ({
      key: option.key,
      text: option.text.trim(),
    })),
    answer: values.answer,
    analysis: values.analysis.trim(),
  };
}

// 详情 → 表单值
export function toQuestionFormValues(question: AdminQuestion): QuestionFormValues {
  return {
    type: question.type ?? 'single',
    stem: question.stem ?? '',
    options: (question.options ?? []).map((option) => ({
      key: option.key ?? '',
      text: option.text ?? '',
    })),
    answer: question.answer ?? [],
    score: question.score ?? 1,
    analysis: question.analysis ?? '',
  };
}
