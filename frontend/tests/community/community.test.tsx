import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedPage from '@/features/community/FeedPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-feed' };
}

// 帖子桩
function post(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    userId: 1,
    nickname: '学员',
    avatarKey: null,
    avatarUrl: null,
    content: '<p>第一帖</p>',
    likeCount: 0,
    likedByMe: false,
    commentCount: 0,
    createdAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  };
}

// 登录普通用户
function loginAsUser() {
  useSessionStore.setState({
    user: {
      id: 1,
      email: 'u@example.com',
      nickname: '学员',
      role: 'user',
      avatarKey: null,
      avatarUrl: null,
      gender: 'secret',
    },
  });
}

describe('FeedPage', () => {
  beforeEach(() => useSessionStore.setState({ user: null }));

  it('展示帖子内容与评论入口', async () => {
    server.use(
      http.get(/\/api\/v1\/posts$/, () =>
        HttpResponse.json(envelope({ items: [post()], total: 1, page: 1, pageSize: 10 })),
      ),
    );

    renderWithProviders([{ path: '/community', element: <FeedPage /> }], '/community');

    expect(await screen.findByText('第一帖')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /评论/ })).toHaveAttribute('href', '/community/1');
  });

  it('游客点赞跳登录并回跳当前地址', async () => {
    server.use(
      http.get(/\/api\/v1\/posts$/, () =>
        HttpResponse.json(envelope({ items: [post()], total: 1, page: 1, pageSize: 10 })),
      ),
    );
    const { router } = renderWithProviders(
      [{ path: '/community', element: <FeedPage /> }],
      '/community',
    );

    await userEvent.click(await screen.findByRole('button', { name: /点赞/ }));
    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        '/login?redirect=%2Fcommunity',
      ),
    );
  });

  it('登录用户点赞后计数更新', async () => {
    loginAsUser();
    // 点赞请求次数
    let liked = 0;
    server.use(
      http.get(/\/api\/v1\/posts$/, () =>
        HttpResponse.json(envelope({ items: [post()], total: 1, page: 1, pageSize: 10 })),
      ),
      http.post(/\/api\/v1\/posts\/1\/like$/, () => {
        liked += 1;
        return HttpResponse.json(envelope(null));
      }),
    );

    renderWithProviders([{ path: '/community', element: <FeedPage /> }], '/community');

    await userEvent.click(await screen.findByRole('button', { name: /点赞/ }));
    await waitFor(() => expect(liked).toBe(1));
  });

  it('空信息流显示空态', async () => {
    server.use(
      http.get(/\/api\/v1\/posts$/, () =>
        HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 10 })),
      ),
    );

    renderWithProviders([{ path: '/community', element: <FeedPage /> }], '/community');
    expect(await screen.findByText('还没有帖子，来发第一帖吧')).toBeInTheDocument();
  });
});
