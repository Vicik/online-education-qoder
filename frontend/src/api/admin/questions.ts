import { request } from '../client';
import type {
  AdminQuestion,
  AdminQuestionStatus,
  AdminQuestionType,
  PageResult,
  QuestionCreateInput,
  QuestionUpdateInput,
} from '../types';

// 管理端题目列表：题型/状态可选筛选
export function listAdminQuestions(
  page = 1,
  pageSize = 10,
  type?: AdminQuestionType,
  status?: AdminQuestionStatus,
): Promise<PageResult<AdminQuestion>> {
  return request<PageResult<AdminQuestion>>({
    url: '/admin/questions',
    method: 'GET',
    params: { page, pageSize, ...(type ? { type } : {}), ...(status ? { status } : {}) },
  });
}

// 创建题目：分值仅创建时确定；创建类 POST 携带幂等键
export function createQuestion(
  input: QuestionCreateInput,
  idempotencyKey: string,
): Promise<AdminQuestion> {
  return request<AdminQuestion>({
    url: '/admin/questions',
    method: 'POST',
    data: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 题目详情（含答案、解析与 version）
export function getAdminQuestion(questionId: number): Promise<AdminQuestion> {
  return request<AdminQuestion>({
    url: `/admin/questions/${questionId}`,
    method: 'GET',
  });
}

// 编辑题目：version 乐观锁；score 由服务端忽略
export function updateQuestion(
  questionId: number,
  input: QuestionUpdateInput,
): Promise<AdminQuestion> {
  return request<AdminQuestion>({
    url: `/admin/questions/${questionId}`,
    method: 'PUT',
    data: input,
  });
}

// 启用题目
export function enableQuestion(questionId: number): Promise<AdminQuestion> {
  return request<AdminQuestion>({
    url: `/admin/questions/${questionId}/enable`,
    method: 'POST',
  });
}

// 停用题目
export function disableQuestion(questionId: number): Promise<AdminQuestion> {
  return request<AdminQuestion>({
    url: `/admin/questions/${questionId}/disable`,
    method: 'POST',
  });
}
