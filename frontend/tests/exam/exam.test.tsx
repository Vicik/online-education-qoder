import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
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
