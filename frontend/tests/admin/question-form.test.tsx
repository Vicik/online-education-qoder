import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import QuestionCreatePage from '@/features/admin/questions/QuestionCreatePage';
import QuestionEditPage from '@/features/admin/questions/QuestionEditPage';
import {
  nextOptionKey,
  toQuestionFormValues,
  toQuestionUpdatePayload,
} from '@/features/admin/questions/payload';
import type { AdminQuestion } from '@/api/types';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-question-form' };
}

// 题目详情桩
const question: AdminQuestion = {
  id: 1,
  type: 'single',
  stem: '以下哪个是 TypeScript 类型？',
  options: [
    { key: 'A', text: 'string' },
    { key: 'B', text: 'number' },
  ],
  score: 5,
  answer: ['A'],
  analysis: 'string 是 TypeScript 的基础类型。',
  status: 'enabled',
  version: 3,
  createdAt: '2026-11-01T02:00:00.000Z',
  updatedAt: '2026-11-02T02:00:00.000Z',
};

// 题目路由
const routes = [
  { path: '/admin/questions', element: <div>question-list</div> },
  { path: '/admin/questions/create', element: <QuestionCreatePage /> },
  { path: '/admin/questions/:id', element: <QuestionEditPage /> },
];

describe('question form', () => {
  it('选项 key 自动补位；编辑载荷不带 score', () => {
    expect(
      nextOptionKey([
        { key: 'A', text: '' },
        { key: 'C', text: '' },
      ]),
    ).toBe('B');

    const values = toQuestionFormValues(question);
    expect(toQuestionUpdatePayload(values, 3)).toEqual({
      version: 3,
      type: 'single',
      stem: '以下哪个是 TypeScript 类型？',
      options: [
        { key: 'A', text: 'string' },
        { key: 'B', text: 'number' },
      ],
      answer: ['A'],
      analysis: 'string 是 TypeScript 的基础类型。',
    });
  });

  it('创建题目：单选只能选一个答案，提交带幂等键并回到列表', async () => {
    // 创建请求体
    let body: Record<string, unknown> | null = null;
    // 创建幂等键
    let key: string | null = null;
    server.use(
      http.post(/\/api\/v1\/admin\/questions$/, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        key = request.headers.get('idempotency-key');
        return HttpResponse.json(envelope(question), { status: 201 });
      }),
    );

    renderWithProviders(routes, '/admin/questions/create');

    await userEvent.type(
      screen.getByLabelText('题干'),
      '以下哪个是 TypeScript 类型？',
    );
    await userEvent.type(screen.getByPlaceholderText('选项 A'), 'string');
    await userEvent.type(screen.getByPlaceholderText('选项 B'), 'number');
    await userEvent.click(screen.getByRole('radio', { name: 'A. string' }));
    await userEvent.clear(screen.getByLabelText('分值'));
    await userEvent.type(screen.getByLabelText('分值'), '5');
    await userEvent.type(
      screen.getByLabelText('答案解析'),
      'string 是 TypeScript 的基础类型。',
    );

    await userEvent.click(screen.getByRole('button', { name: '创建题目' }));
    await userEvent.click(await screen.findByRole('button', { name: '确认创建' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({
      type: 'single',
      stem: '以下哪个是 TypeScript 类型？',
      options: [
        { key: 'A', text: 'string' },
        { key: 'B', text: 'number' },
      ],
      answer: ['A'],
      analysis: 'string 是 TypeScript 的基础类型。',
      score: 5,
    });
    expect(await screen.findByText('question-list')).toBeInTheDocument();
  });

  it('编辑题目：分值只读，保存带 version 且不带 score', async () => {
    // 编辑请求体
    let body: Record<string, unknown> | null = null;
    server.use(
      http.get(/\/api\/v1\/admin\/questions\/1$/, () =>
        HttpResponse.json(envelope(question)),
      ),
      http.put(/\/api\/v1\/admin\/questions\/1$/, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(envelope({ ...question, version: 4 }));
      }),
    );

    renderWithProviders(routes, '/admin/questions/1');

    expect(
      await screen.findByDisplayValue('以下哪个是 TypeScript 类型？'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('分值')).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await userEvent.click(await screen.findByRole('button', { name: '确认保存' }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({ version: 3 });
    expect(body).not.toHaveProperty('score');
  });

  it('保存遇 409：弹出刷新提示，点刷新重取详情', async () => {
    // 详情请求次数
    let detailCount = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/questions\/1$/, () => {
        detailCount += 1;
        return HttpResponse.json(envelope(question));
      }),
      http.put(/\/api\/v1\/admin\/questions\/1$/, () =>
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

    renderWithProviders(routes, '/admin/questions/1');

    await screen.findByDisplayValue('以下哪个是 TypeScript 类型？');
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
