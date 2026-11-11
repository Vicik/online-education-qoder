import { request } from '../client';
import type {
  AdminExam,
  AdminExamDetail,
  ExamCreateInput,
  ExamUpdateInput,
  PageResult,
} from '../types';

// 管理端考试列表：后端无状态筛选
export function listAdminExams(page = 1, pageSize = 10): Promise<PageResult<AdminExam>> {
  return request<PageResult<AdminExam>>({
    url: '/admin/exams',
    method: 'GET',
    params: { page, pageSize },
  });
}

// 创建考试（草稿组卷）：创建类 POST 携带幂等键
export function createExam(
  input: ExamCreateInput,
  idempotencyKey: string,
): Promise<AdminExamDetail> {
  return request<AdminExamDetail>({
    url: '/admin/exams',
    method: 'POST',
    data: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 考试详情（含 version 与题目顺序）
export function getAdminExam(examId: number): Promise<AdminExamDetail> {
  return request<AdminExamDetail>({
    url: `/admin/exams/${examId}`,
    method: 'GET',
  });
}

// 编辑考试：仅草稿；version 乐观锁
export function updateExam(
  examId: number,
  input: ExamUpdateInput,
): Promise<AdminExamDetail> {
  return request<AdminExamDetail>({
    url: `/admin/exams/${examId}`,
    method: 'PUT',
    data: input,
  });
}

// 发布考试：冻结题目快照
export function publishExam(examId: number): Promise<AdminExamDetail> {
  return request<AdminExamDetail>({
    url: `/admin/exams/${examId}/publish`,
    method: 'POST',
  });
}

// 结束考试：仅已发布可执行
export function endExam(examId: number): Promise<AdminExamDetail> {
  return request<AdminExamDetail>({
    url: `/admin/exams/${examId}/end`,
    method: 'POST',
  });
}
