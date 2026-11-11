import { request } from './client';
import type {
  AttemptResultData,
  AttemptStartData,
  ExamBrief,
  MyExamRecord,
  PageResult,
  SubmitData,
} from './types';

// 已发布考试列表
export function listExams(page = 1, pageSize = 12): Promise<PageResult<ExamBrief>> {
  return request({ url: '/exams', method: 'GET', params: { page, pageSize } });
}

// 考试详情（不含题目与答案）
export function getExam(examId: number): Promise<ExamBrief> {
  return request({ url: `/exams/${examId}`, method: 'GET' });
}

// 开始考试：重复调用幂等返回既有记录
export function startAttempt(examId: number): Promise<AttemptStartData> {
  return request({ url: `/exams/${examId}/attempts`, method: 'POST', data: {} });
}

// 交卷：服务端按 attempt 状态幂等，不携带 Idempotency-Key
export function submitAttempt(
  examId: number,
  attemptId: number,
  answers: Record<string, string[]>,
): Promise<SubmitData> {
  return request({
    url: `/exams/${examId}/attempts/${attemptId}/submit`,
    method: 'POST',
    data: { answers },
  });
}

// 成绩与解析：仅交卷后可查
export function getAttemptResult(
  examId: number,
  attemptId: number,
): Promise<AttemptResultData> {
  return request({
    url: `/exams/${examId}/attempts/${attemptId}/result`,
    method: 'GET',
  });
}

// 我的考试记录
export function listMyExamRecords(page = 1, pageSize = 10): Promise<PageResult<MyExamRecord>> {
  return request({ url: '/user/exams', method: 'GET', params: { page, pageSize } });
}

// 本地题号作答映射转为接口载荷：丢弃未作答的空数组
export function toAnswerPayload(
  answers: Record<number, string[]>,
): Record<string, string[]> {
  // 接口载荷：题 id 字符串 -> 选项 key 数组
  const payload: Record<string, string[]> = {};
  for (const [questionId, keys] of Object.entries(answers)) {
    if (keys.length > 0) payload[questionId] = keys;
  }
  return payload;
}
