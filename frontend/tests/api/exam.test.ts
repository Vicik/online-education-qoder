import { http, HttpResponse } from 'msw';
import {
  getAttemptResult,
  listExams,
  listMyExamRecords,
  startAttempt,
  submitAttempt,
  toAnswerPayload,
} from '@/api/exam';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-exam' };
}

// 考试摘要桩
const exam = {
  id: 1,
  title: '期中测验',
  description: '第一次阶段测验',
  durationMin: 60,
  passScore: 6,
  totalScore: 10,
  questionCount: 2,
  status: 'published',
  publishedAt: '2026-11-09T00:00:00.000Z',
};

// 开始考试桩
const started = {
  attemptId: 7,
  examId: 1,
  examTitle: '期中测验',
  durationMin: 60,
  deadlineAt: '2099-01-01T00:00:00.000Z',
  totalScore: 10,
  passScore: 6,
  questions: [
    {
      id: 101,
      type: 'single',
      stem: '单选题干',
      options: [
        { key: 'A', text: '选项A' },
        { key: 'B', text: '选项B' },
      ],
      score: 5,
    },
  ],
};

describe('exam api', () => {
  it('列表透传分页参数', async () => {
    // 捕获页码
    let page = '';
    server.use(
      http.get(/\/api\/v1\/exams$/, ({ request }) => {
        page = new URL(request.url).searchParams.get('page') ?? '';
        return HttpResponse.json(
          envelope({ items: [exam], total: 1, page: 2, pageSize: 10 }),
        );
      }),
    );

    const result = await listExams(2, 10);
    expect(page).toBe('2');
    expect(result.items[0].questionCount).toBe(2);
  });

  it('开始考试返回服务端截止时间且题目不含答案', async () => {
    server.use(
      http.post(/\/api\/v1\/exams\/1\/attempts$/, () =>
        HttpResponse.json(envelope(started), { status: 201 }),
      ),
    );

    const data = await startAttempt(1);
    expect(data.deadlineAt).toBe('2099-01-01T00:00:00.000Z');
    expect(data.questions?.[0]).not.toHaveProperty('answer');
    expect(data.questions?.[0]).not.toHaveProperty('analysis');
  });

  it('交卷提交答案映射且不带幂等键', async () => {
    // 请求体
    let body: unknown = null;
    // 幂等键（应为空）
    let key: string | null = 'unset';
    server.use(
      http.post(/\/api\/v1\/exams\/1\/attempts\/7\/submit$/, async ({ request }) => {
        body = await request.json();
        key = request.headers.get('idempotency-key');
        return HttpResponse.json(
          envelope({
            attemptId: 7,
            score: 5,
            totalScore: 10,
            passScore: 6,
            passed: false,
            submittedAt: '2026-11-10T00:05:00.000Z',
          }),
        );
      }),
    );

    const result = await submitAttempt(1, 7, { '101': ['A'] });
    expect(body).toEqual({ answers: { '101': ['A'] } });
    expect(key).toBeNull();
    expect(result.score).toBe(5);
  });

  it('未交卷查询成绩抛出 422 ApiError', async () => {
    server.use(
      http.get(/\/api\/v1\/exams\/1\/attempts\/7\/result$/, () =>
        HttpResponse.json(
          { code: 1001, message: '考试尚未交卷，暂不可查看成绩', data: null, requestId: 'r-unsubmitted' },
          { status: 422 },
        ),
      ),
    );

    await expect(getAttemptResult(1, 7)).rejects.toMatchObject({
      code: 1001,
      status: 422,
    });
  });

  it('我的考试记录包含 examId 与未交卷空值', async () => {
    server.use(
      http.get(/\/api\/v1\/user\/exams$/, () =>
        HttpResponse.json(
          envelope({
            items: [
              {
                attemptId: 9,
                examId: 5,
                examTitle: '期中测验',
                score: null,
                totalScore: 10,
                passScore: 6,
                passed: null,
                submittedAt: null,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 10,
          }),
        ),
      ),
    );

    const result = await listMyExamRecords(1, 10);
    expect(result.items[0].examId).toBe(5);
    expect(result.items[0].score).toBeNull();
  });

  it('空答案不进入交卷载荷', () => {
    expect(toAnswerPayload({ 101: ['A'], 102: [] })).toEqual({ '101': ['A'] });
  });
});
