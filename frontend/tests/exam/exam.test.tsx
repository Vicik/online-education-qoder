import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExamDetailPage from '@/features/exam/ExamDetailPage';
import ExamListPage from '@/features/exam/ExamListPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-exam' };
}

// 考试摘要桩
function examBrief(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    title: '期中测验',
    description: '第一次阶段测验',
    durationMin: 60,
    passScore: 6,
    totalScore: 10,
    questionCount: 2,
    status: 'published',
    publishedAt: '2026-11-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('ExamListPage', () => {
  it('展示考试关键信息与入口', async () => {
    server.use(
      http.get(/\/api\/v1\/exams$/, () =>
        HttpResponse.json(envelope({ items: [examBrief()], total: 1, page: 1, pageSize: 12 })),
      ),
    );

    renderWithProviders([{ path: '/exams', element: <ExamListPage /> }], '/exams');

    expect(await screen.findByText('期中测验')).toBeInTheDocument();
    expect(screen.getByText('时长：60 分钟')).toBeInTheDocument();
    expect(screen.getByText('题数：2')).toBeInTheDocument();
    expect(screen.getByText('及格分 6 / 总分 10')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入考试' })).toHaveAttribute('href', '/exams/1');
  });

  it('无考试时显示空态', async () => {
    server.use(
      http.get(/\/api\/v1\/exams$/, () =>
        HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 12 })),
      ),
    );

    renderWithProviders([{ path: '/exams', element: <ExamListPage /> }], '/exams');
    expect(await screen.findByText('暂无可参加的考试')).toBeInTheDocument();
  });
});

// 开始考试返回桩
function startData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
      {
        id: 102,
        type: 'multiple',
        stem: '多选题干',
        options: [
          { key: 'A', text: '选项A' },
          { key: 'B', text: '选项B' },
          { key: 'C', text: '选项C' },
        ],
        score: 5,
      },
    ],
    ...overrides,
  };
}

// 未交卷错误响应
function unsubmittedResponse() {
  return HttpResponse.json(
    { code: 1001, message: '考试尚未交卷，暂不可查看成绩', data: null, requestId: 'r-unsubmitted' },
    { status: 422 },
  );
}

// 成绩桩
function resultData() {
  return {
    attemptId: 7,
    examTitle: '期中测验',
    score: 10,
    totalScore: 10,
    passScore: 6,
    passed: true,
    submittedAt: '2026-11-10T00:05:00.000Z',
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
        userAnswers: ['A'],
        correctAnswers: ['A'],
        analysis: '单选解析',
      },
      {
        id: 102,
        type: 'multiple',
        stem: '多选题干',
        options: [
          { key: 'A', text: '选项A' },
          { key: 'B', text: '选项B' },
          { key: 'C', text: '选项C' },
        ],
        score: 5,
        userAnswers: ['A', 'C'],
        correctAnswers: ['A', 'B'],
        analysis: '多选解析',
      },
    ],
  };
}

// 详情 + 开始 + 未交卷探测
function mockStartToAnswering() {
  server.use(
    http.get(/\/api\/v1\/exams\/1$/, () => HttpResponse.json(envelope(examBrief()))),
    http.post(/\/api\/v1\/exams\/1\/attempts$/, () =>
      HttpResponse.json(envelope(startData()), { status: 201 }),
    ),
    http.get(/\/api\/v1\/exams\/1\/attempts\/7\/result$/, () => unsubmittedResponse()),
  );
}

// 路由表：详情页 + 列表占位
const detailRoutes = [
  { path: '/exams', element: <div>exam-list</div> },
  { path: '/exams/:id', element: <ExamDetailPage /> },
];

describe('ExamDetailPage', () => {
  it('展示考试信息并在确认后进入答题', async () => {
    mockStartToAnswering();
    renderWithProviders(detailRoutes, '/exams/1');

    expect(await screen.findByText('期中测验')).toBeInTheDocument();
    expect(screen.getByText('时长：60 分钟')).toBeInTheDocument();
    expect(screen.getByText('题数：2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '开始考试' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    expect(await screen.findByText('单选题干')).toBeInTheDocument();
    expect(screen.getByText('多选题干')).toBeInTheDocument();
  });

  it('单选渲染 Radio、多选渲染 Checkbox，且不展示答案', async () => {
    mockStartToAnswering();
    renderWithProviders(detailRoutes, '/exams/1');

    await userEvent.click(await screen.findByRole('button', { name: '开始考试' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));
    await screen.findByText('单选题干');

    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryByText('正确答案：A')).not.toBeInTheDocument();
    expect(screen.queryByText(/解析：/)).not.toBeInTheDocument();
  });

  it('已交卷时开始后直接展示成绩', async () => {
    server.use(
      http.get(/\/api\/v1\/exams\/1$/, () => HttpResponse.json(envelope(examBrief()))),
      http.post(/\/api\/v1\/exams\/1\/attempts$/, () =>
        HttpResponse.json(envelope(startData()), { status: 201 }),
      ),
      http.get(/\/api\/v1\/exams\/1\/attempts\/7\/result$/, () =>
        HttpResponse.json(envelope(resultData())),
      ),
    );

    renderWithProviders(detailRoutes, '/exams/1');

    await userEvent.click(await screen.findByRole('button', { name: '开始考试' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    expect(await screen.findByText('10 / 10')).toBeInTheDocument();
    expect(screen.getByText('及格')).toBeInTheDocument();
  });

  it('交卷携带答案映射并展示成绩与解析', async () => {
    // 交卷载荷
    let body: Record<string, string[]> | null = null;
    // 成绩接口调用次数：首次探测 422，交卷后 200
    let resultCalls = 0;
    server.use(
      http.get(/\/api\/v1\/exams\/1$/, () => HttpResponse.json(envelope(examBrief()))),
      http.post(/\/api\/v1\/exams\/1\/attempts$/, () =>
        HttpResponse.json(envelope(startData()), { status: 201 }),
      ),
      http.get(/\/api\/v1\/exams\/1\/attempts\/7\/result$/, () => {
        resultCalls += 1;
        return resultCalls === 1
          ? unsubmittedResponse()
          : HttpResponse.json(envelope(resultData()));
      }),
      http.post(/\/api\/v1\/exams\/1\/attempts\/7\/submit$/, async ({ request }) => {
        body = ((await request.json()) as { answers: Record<string, string[]> }).answers;
        return HttpResponse.json(
          envelope({
            attemptId: 7,
            score: 10,
            totalScore: 10,
            passScore: 6,
            passed: true,
            submittedAt: '2026-11-10T00:05:00.000Z',
          }),
        );
      }),
    );

    renderWithProviders(detailRoutes, '/exams/1');

    await userEvent.click(await screen.findByRole('button', { name: '开始考试' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));
    await screen.findByText('单选题干');

    // 单选 A；多选 A、C
    await userEvent.click(screen.getAllByRole('radio')[0]);
    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    await userEvent.click(screen.getAllByRole('checkbox')[2]);

    await userEvent.click(screen.getByRole('button', { name: '交卷' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(body).toEqual({ '101': ['A'], '102': ['A', 'C'] }));
    expect(await screen.findByText('10 / 10')).toBeInTheDocument();
    expect(screen.getByText('正确答案：A、B')).toBeInTheDocument();
    expect(screen.getByText('你的答案：A、C')).toBeInTheDocument();
    expect(screen.getByText('解析：多选解析')).toBeInTheDocument();
  });

  it('未答完交卷需确认，取消不发请求', async () => {
    // 是否发出交卷请求
    let submitted = false;
    server.use(
      http.get(/\/api\/v1\/exams\/1$/, () => HttpResponse.json(envelope(examBrief()))),
      http.post(/\/api\/v1\/exams\/1\/attempts$/, () =>
        HttpResponse.json(envelope(startData()), { status: 201 }),
      ),
      http.get(/\/api\/v1\/exams\/1\/attempts\/7\/result$/, () => unsubmittedResponse()),
      http.post(/\/api\/v1\/exams\/1\/attempts\/7\/submit$/, () => {
        submitted = true;
        return HttpResponse.json(
          envelope({
            attemptId: 7,
            score: 0,
            totalScore: 10,
            passScore: 6,
            passed: false,
            submittedAt: '2026-11-10T00:05:00.000Z',
          }),
        );
      }),
    );

    renderWithProviders(detailRoutes, '/exams/1');

    await userEvent.click(await screen.findByRole('button', { name: '开始考试' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));
    await screen.findByText('单选题干');

    await userEvent.click(screen.getByRole('button', { name: '交卷' }));
    expect(
      await screen.findByText('还有 2 题未作答，交卷后不可修改，确认交卷？'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() =>
      expect(
        screen.queryByText('还有 2 题未作答，交卷后不可修改，确认交卷？'),
      ).not.toBeInTheDocument(),
    );
    expect(submitted).toBe(false);
  });

  it('到达截止时间自动交卷', async () => {
    // 3 秒后截止：留出开始考试的交互耗时，避免截止发生在进入答题页之前
    const deadlineAt = new Date(Date.now() + 3000).toISOString();
    // 自动交卷载荷
    let body: Record<string, string[]> | null = null;
    // 成绩接口调用次数
    let resultCalls = 0;
    server.use(
      http.get(/\/api\/v1\/exams\/1$/, () => HttpResponse.json(envelope(examBrief()))),
      http.post(/\/api\/v1\/exams\/1\/attempts$/, () =>
        HttpResponse.json(envelope(startData({ deadlineAt })), { status: 201 }),
      ),
      http.get(/\/api\/v1\/exams\/1\/attempts\/7\/result$/, () => {
        resultCalls += 1;
        return resultCalls === 1
          ? unsubmittedResponse()
          : HttpResponse.json(envelope(resultData()));
      }),
      http.post(/\/api\/v1\/exams\/1\/attempts\/7\/submit$/, async ({ request }) => {
        body = ((await request.json()) as { answers: Record<string, string[]> }).answers;
        return HttpResponse.json(
          envelope({
            attemptId: 7,
            score: 0,
            totalScore: 10,
            passScore: 6,
            passed: false,
            submittedAt: '2026-11-10T00:05:00.000Z',
          }),
        );
      }),
    );

    renderWithProviders(detailRoutes, '/exams/1');

    await userEvent.click(await screen.findByRole('button', { name: '开始考试' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));
    await screen.findByText('单选题干');

    await waitFor(() => expect(body).toEqual({}), { timeout: 8000 });
    expect(await screen.findByText('10 / 10')).toBeInTheDocument();
  });

  it('6002 提示考试已结束并返回列表', async () => {
    server.use(
      http.get(/\/api\/v1\/exams\/1$/, () => HttpResponse.json(envelope(examBrief()))),
      http.post(/\/api\/v1\/exams\/1\/attempts$/, () =>
        HttpResponse.json(envelope(startData()), { status: 201 }),
      ),
      http.get(/\/api\/v1\/exams\/1\/attempts\/7\/result$/, () => unsubmittedResponse()),
      http.post(/\/api\/v1\/exams\/1\/attempts\/7\/submit$/, () =>
        HttpResponse.json(
          { code: 6002, message: '考试已结束', data: null, requestId: 'r-ended' },
          { status: 422 },
        ),
      ),
    );

    const { router } = renderWithProviders(detailRoutes, '/exams/1');

    await userEvent.click(await screen.findByRole('button', { name: '开始考试' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));
    await screen.findByText('单选题干');

    await userEvent.click(screen.getByRole('button', { name: '交卷' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/exams'));
  });
});
