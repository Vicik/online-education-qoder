import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import ExamListPage from '@/features/admin/exams/ExamListPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-exam-list' };
}

// 考试工厂
function exam(id: number, status: string, title: string) {
  return {
    id,
    title,
    description: '',
    durationMin: 60,
    passScore: 60,
    totalScore: 100,
    questionCount: 2,
    status,
    publishedAt: status === 'draft' ? null : '2026-11-05T02:00:00.000Z',
  };
}

describe('ExamListPage', () => {
  it('按状态展示操作：草稿可编辑/发布，已发布可结束，已结束只读', async () => {
    // 发布接口访问次数
    let publishCount = 0;
    // 结束接口访问次数
    let endCount = 0;
    // 列表请求次数
    let listCount = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/exams$/, () => {
        listCount += 1;
        return HttpResponse.json(
          envelope({
            items: [exam(1, 'draft', '草稿考试'), exam(2, 'published', '已发布考试'), exam(3, 'ended', '已结束考试')],
            total: 3,
            page: 1,
            pageSize: 10,
          }),
        );
      }),
      http.post(/\/api\/v1\/admin\/exams\/1\/publish$/, () => {
        publishCount += 1;
        return HttpResponse.json(envelope(exam(1, 'published', '草稿考试')));
      }),
      http.post(/\/api\/v1\/admin\/exams\/2\/end$/, () => {
        endCount += 1;
        return HttpResponse.json(envelope(exam(2, 'ended', '已发布考试')));
      }),
    );

    renderWithProviders(
      [{ path: '/admin/exams', element: <ExamListPage /> }],
      '/admin/exams',
    );

    expect(await screen.findByText('草稿考试')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '编辑' })).toHaveAttribute(
      'href',
      '/admin/exams/1',
    );

    // 发布草稿：二次确认
    await userEvent.click(screen.getByRole('button', { name: '发布' }));
    expect(
      await screen.findByText('发布后将冻结题目快照，之后不可修改，确认发布？'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认发布' }));
    await waitFor(() => expect(publishCount).toBe(1));

    // 结束已发布考试：二次确认
    await userEvent.click(screen.getByRole('button', { name: '结束' }));
    expect(
      await screen.findByText('结束后用户将无法再参加，确认结束？'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确认结束' }));
    await waitFor(() => expect(endCount).toBe(1));

    // 每次写操作后刷新列表
    await waitFor(() => expect(listCount).toBe(3));
  });
});
