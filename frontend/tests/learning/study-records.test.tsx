import { http, HttpResponse } from 'msw';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StudyRecordsPage from '@/features/user-center/StudyRecordsPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-records' };
}

describe('StudyRecordsPage', () => {
  beforeEach(() => {
    useSessionStore.getState().setUser({
      id: 2,
      email: 'user@example.com',
      nickname: '学员',
      avatarKey: null,
      avatarUrl: null,
      gender: 'secret',
      role: 'user',
      createdAt: '2026-11-01T00:00:00.000Z',
    } as never);
  });

  afterEach(() => {
    // 先卸载组件再清空登录态，避免已挂载组件在 act 外更新
    cleanup();
    useSessionStore.getState().clear();
  });

  it('展示进度条与课程卡片，继续观看带 chapterId', async () => {
    server.use(
      http.get(/\/api\/v1\/user\/study-records$/, () =>
        HttpResponse.json(
          envelope({
            items: [
              {
                courseId: 1,
                courseName: 'TypeScript 系统入门',
                chapterCount: 2,
                visitedCount: 2,
                lastChapterId: 12,
                lastChapterTitle: '第二章 泛型',
                progressPercent: 100,
                completed: true,
                lastVisitedAt: '2026-11-10T02:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    );

    const { router } = renderWithProviders(
      [
        { path: '/user/study-records', element: <StudyRecordsPage /> },
        { path: '/learning/:courseId', element: <div>learning-page</div> },
      ],
      '/user/study-records',
    );

    expect(await screen.findByText('TypeScript 系统入门')).toBeInTheDocument();
    // 改版后仅用进度条表达百分比，不展示数字、已学完标记与最近章节
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    );

    await userEvent.click(screen.getByRole('button', { name: '继续观看' }));
    expect(router.state.location.pathname).toBe('/learning/1');
    expect(router.state.location.search).toBe('?chapterId=12');
  });

  it('空记录展示空态', async () => {
    server.use(
      http.get(/\/api\/v1\/user\/study-records$/, () =>
        HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 20 })),
      ),
    );

    renderWithProviders(
      [{ path: '/user/study-records', element: <StudyRecordsPage /> }],
      '/user/study-records',
    );
    expect(await screen.findByText('暂无学习记录')).toBeInTheDocument();
  });

  it('未学完且无最近章节展示对应进度，继续观看不带 chapterId', async () => {
    server.use(
      http.get(/\/api\/v1\/user\/study-records$/, () =>
        HttpResponse.json(
          envelope({
            items: [
              {
                courseId: 1,
                courseName: 'TypeScript 系统入门',
                chapterCount: 2,
                visitedCount: 1,
                lastChapterId: null,
                lastChapterTitle: null,
                progressPercent: 30,
                completed: false,
                lastVisitedAt: '2026-11-10T02:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    );

    const { router } = renderWithProviders(
      [
        { path: '/user/study-records', element: <StudyRecordsPage /> },
        { path: '/learning/:courseId', element: <div>learning-page</div> },
      ],
      '/user/study-records',
    );

    expect(await screen.findByText('TypeScript 系统入门')).toBeInTheDocument();
    // 改版后无状态标记与最近章节，进度仅由进度条数值表达
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '30',
    );
    expect(screen.queryByText('学习中')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '继续观看' }));
    expect(router.state.location.pathname).toBe('/learning/1');
    expect(router.state.location.search).toBe('');
  });

  it('接口失败展示加载失败并可重试', async () => {
    let attempts = 0;
    server.use(
      http.get(/\/api\/v1\/user\/study-records$/, () => {
        attempts += 1;
        return HttpResponse.json(
          { code: 1006, message: '请求失败', data: null, requestId: 'r-500' },
          { status: 500 },
        );
      }),
    );

    renderWithProviders(
      [{ path: '/user/study-records', element: <StudyRecordsPage /> }],
      '/user/study-records',
    );

    expect(await screen.findByText('加载失败')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(attempts).toBe(2));
  });
});
