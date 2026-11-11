import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import ExamCreatePage from '@/features/admin/exams/ExamCreatePage';
import ExamEditPage from '@/features/admin/exams/ExamEditPage';
import { totalScoreOf, toExamUpdatePayload } from '@/features/admin/exams/payload';
import type { AdminQuestion } from '@/api/types';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-exam-form' };
}

// 题目池桩
const questions: AdminQuestion[] = [
  {
    id: 1,
    type: 'single',
    stem: '第一题',
    options: [
      { key: 'A', text: '选项一' },
      { key: 'B', text: '选项二' },
    ],
    score: 5,
    answer: ['A'],
    analysis: '解析',
    status: 'enabled',
    version: 1,
    createdAt: '2026-11-01T02:00:00.000Z',
    updatedAt: '2026-11-02T02:00:00.000Z',
  },
  {
    id: 2,
    type: 'multiple',
    stem: '第二题',
    options: [
      { key: 'A', text: '选项一' },
      { key: 'B', text: '选项二' },
    ],
    score: 10,
    answer: ['A', 'B'],
    analysis: '解析',
    status: 'enabled',
    version: 1,
    createdAt: '2026-11-01T02:00:00.000Z',
    updatedAt: '2026-11-02T02:00:00.000Z',
  },
];

// 考试详情桩（草稿）
const examDetail = {
  id: 3,
  title: '期中考试',
  description: '覆盖前四章',
  durationMin: 60,
  passScore: 9,
  totalScore: 15,
  questionCount: 2,
  status: 'draft',
  publishedAt: null,
  version: 4,
  questionIds: [2, 1],
};

// 题目池接口
const poolHandler = http.get(/\/api\/v1\/admin\/questions$/, () =>
  HttpResponse.json(
    envelope({ items: questions, total: 2, page: 1, pageSize: 100 }),
  ),
);

// 考试路由
const routes = [
  { path: '/admin/exams', element: <div>exam-list</div> },
  { path: '/admin/exams/create', element: <ExamCreatePage /> },
  { path: '/admin/exams/:id', element: <ExamEditPage /> },
];

describe('exam form', () => {
  it('总分按已选题目计算；编辑载荷带 version 与题目顺序', () => {
    expect(totalScoreOf(questions, [2, 1])).toBe(15);
    expect(
      toExamUpdatePayload(
        {
          title: '期中考试',
          description: '覆盖前四章',
          durationMin: 60,
          passScore: 9,
          questionIds: [2, 1],
        },
        4,
      ),
    ).toEqual({
      version: 4,
      title: '期中考试',
      description: '覆盖前四章',
      durationMin: 60,
      passScore: 9,
      questionIds: [2, 1],
    });
  });

  it('创建考试：选题定序、总分实时、及格分不超总分，提交带幂等键', async () => {
    // 创建请求体
    let body: Record<string, unknown> | null = null;
    // 创建幂等键
    let key: string | null = null;
    server.use(
      poolHandler,
      http.post(/\/api\/v1\/admin\/exams$/, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        key = request.headers.get('idempotency-key');
        return HttpResponse.json(envelope(examDetail), { status: 201 });
      }),
    );

    renderWithProviders(routes, '/admin/exams/create');

    await userEvent.type(screen.getByLabelText('考试名称'), '期中考试');
    await userEvent.type(screen.getByLabelText('考试说明'), '覆盖前四章');

    // 选择两道题
    await userEvent.click(screen.getByRole('combobox', { name: '组卷题目' }));
    await userEvent.click(await screen.findByText('第一题（5 分）'));
    await userEvent.click(await screen.findByText('第二题（10 分）'));
    await userEvent.keyboard('{Escape}');

    expect(screen.getByTestId('exam-total')).toHaveTextContent('试卷总分：15 分');

    // 第二题上移，形成 [2, 1]
    await userEvent.click(
      within(screen.getByTestId('question-order-2')).getByRole('button', {
        name: '上移',
      }),
    );

    // 及格分超过总分先被表单拦截
    await userEvent.type(screen.getByLabelText('及格分'), '20');
    await userEvent.click(screen.getByRole('button', { name: '创建考试' }));
    expect(
      await screen.findByText('及格分需大于 0 且不超过总分'),
    ).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('及格分'));
    await userEvent.type(screen.getByLabelText('及格分'), '9');
    await userEvent.click(screen.getByRole('button', { name: '创建考试' }));
    await userEvent.click(await screen.findByRole('button', { name: '确认创建' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({
      title: '期中考试',
      description: '覆盖前四章',
      durationMin: 60,
      passScore: 9,
      questionIds: [2, 1],
    });
    expect(await screen.findByText('exam-list')).toBeInTheDocument();
  });

  it('草稿详情回填题目顺序，保存带 version', async () => {
    // 编辑请求体
    let body: Record<string, unknown> | null = null;
    server.use(
      poolHandler,
      http.get(/\/api\/v1\/admin\/exams\/3$/, () =>
        HttpResponse.json(envelope(examDetail)),
      ),
      http.put(/\/api\/v1\/admin\/exams\/3$/, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(envelope({ ...examDetail, version: 5 }));
      }),
    );

    renderWithProviders(routes, '/admin/exams/3');

    expect(await screen.findByDisplayValue('期中考试')).toBeInTheDocument();
    // 题目池与详情异步加载，等待总分按题目分值算出
    await waitFor(() =>
      expect(screen.getByTestId('exam-total')).toHaveTextContent(
        '试卷总分：15 分',
      ),
    );
    // 第一行应是题目 2
    const firstRow = screen.getByTestId('question-order-2');
    expect(within(firstRow).getByText(/第二题/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await userEvent.click(await screen.findByRole('button', { name: '确认保存' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({
      version: 4,
      title: '期中考试',
      description: '覆盖前四章',
      durationMin: 60,
      passScore: 9,
      questionIds: [2, 1],
    });
  });

  it('已发布考试只读并提示题目已冻结', async () => {
    server.use(
      poolHandler,
      http.get(/\/api\/v1\/admin\/exams\/3$/, () =>
        HttpResponse.json(
          envelope({ ...examDetail, status: 'published' }),
        ),
      ),
    );

    renderWithProviders(routes, '/admin/exams/3');

    expect(
      await screen.findByText('考试已发布，题目已冻结，不可编辑'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('考试名称')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });

  it('保存遇 409：弹出刷新提示，点刷新重取详情', async () => {
    // 详情请求次数
    let detailCount = 0;
    server.use(
      poolHandler,
      http.get(/\/api\/v1\/admin\/exams\/3$/, () => {
        detailCount += 1;
        return HttpResponse.json(envelope(examDetail));
      }),
      http.put(/\/api\/v1\/admin\/exams\/3$/, () =>
        HttpResponse.json(
          {
            code: 4004,
            message: '数据已被修改，请刷新后重试',
            data: null,
            requestId: 'r-conflict',
          },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(routes, '/admin/exams/3');

    await screen.findByDisplayValue('期中考试');
    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await userEvent.click(await screen.findByRole('button', { name: '确认保存' }));

    expect(
      await screen.findByText('内容已在其他页面被修改，请刷新后重试'),
    ).toBeInTheDocument();
    expect(detailCount).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(detailCount).toBe(2));
  });
});
