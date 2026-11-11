import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import QuestionListPage from '@/features/admin/questions/QuestionListPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-question-list' };
}

// 题目工厂
function question(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'single',
    stem: `题目 ${id}`,
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
    ...overrides,
  };
}

describe('QuestionListPage', () => {
  it('展示题型/状态/更新时间，并按题型与状态筛选', async () => {
    // 最近一次查询参数
    let query = new URLSearchParams();
    server.use(
      http.get(/\/api\/v1\/admin\/questions$/, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(
          envelope({
            items: [question(1), question(2, { type: 'multiple', status: 'disabled' })],
            total: 2,
            page: 1,
            pageSize: 10,
          }),
        );
      }),
    );

    renderWithProviders(
      [{ path: '/admin/questions', element: <QuestionListPage /> }],
      '/admin/questions',
    );

    expect(await screen.findByText('题目 1')).toBeInTheDocument();
    expect(screen.getAllByText('单选').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '题目 1' })).toHaveAttribute(
      'href',
      '/admin/questions/1',
    );

    await userEvent.click(
      await screen.findByRole('combobox', { name: '题型筛选' }),
    );
    await userEvent.click(await screen.findByTitle('多选'));
    await waitFor(() => expect(query.get('type')).toBe('multiple'));

    await userEvent.click(
      await screen.findByRole('combobox', { name: '状态筛选' }),
    );
    await userEvent.click(await screen.findByTitle('已停用'));
    await waitFor(() => expect(query.get('status')).toBe('disabled'));
  });

  it('停用题目：确认后调用停用接口并刷新列表', async () => {
    // 停用接口访问次数
    let disableCount = 0;
    // 列表请求次数
    let listCount = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/questions$/, () => {
        listCount += 1;
        return HttpResponse.json(
          envelope({ items: [question(1)], total: 1, page: 1, pageSize: 10 }),
        );
      }),
      http.post(/\/api\/v1\/admin\/questions\/1\/disable$/, () => {
        disableCount += 1;
        return HttpResponse.json(
          envelope(question(1, { status: 'disabled' })),
        );
      }),
    );

    renderWithProviders(
      [{ path: '/admin/questions', element: <QuestionListPage /> }],
      '/admin/questions',
    );

    await userEvent.click(await screen.findByRole('button', { name: '停用' }));
    await userEvent.click(await screen.findByRole('button', { name: '确认停用' }));

    await waitFor(() => expect(disableCount).toBe(1));
    await waitFor(() => expect(listCount).toBe(2));
  });
});
