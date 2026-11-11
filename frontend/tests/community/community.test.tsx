import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedPage from '@/features/community/FeedPage';
import PostDetailPage from '@/features/community/PostDetailPage';
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

// 帖子详情桩：一层评论 + 一条回复
function detail() {
  return {
    ...post({ commentCount: 2 }),
    comments: [
      {
        id: 11,
        userId: 2,
        nickname: '小明',
        content: '<p>一级评论</p>',
        createdAt: '2026-11-10T00:00:00.000Z',
        replies: [
          {
            id: 12,
            userId: 3,
            nickname: '小红',
            replyToNickname: '小明',
            content: '<p>回复内容</p>',
            createdAt: '2026-11-10T00:00:00.000Z',
          },
        ],
      },
    ],
  };
}

describe('PostDetailPage', () => {
  beforeEach(() => useSessionStore.setState({ user: null }));

  it('展示两层评论与回复目标', async () => {
    server.use(http.get(/\/api\/v1\/posts\/1$/, () => HttpResponse.json(envelope(detail()))));

    renderWithProviders([{ path: '/community/:postId', element: <PostDetailPage /> }], '/community/1');

    expect(await screen.findByText('一级评论')).toBeInTheDocument();
    expect(screen.getByText('回复内容')).toBeInTheDocument();
    expect(screen.getByText('回复 @小明')).toBeInTheDocument();
  });

  it('游客发表评论跳登录并回跳', async () => {
    server.use(http.get(/\/api\/v1\/posts\/1$/, () => HttpResponse.json(envelope(detail()))));
    const { router } = renderWithProviders(
      [{ path: '/community/:postId', element: <PostDetailPage /> }],
      '/community/1',
    );

    await userEvent.click(await screen.findByRole('button', { name: '登录后发表评论' }));

    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        '/login?redirect=%2Fcommunity%2F1',
      ),
    );
  });

  it('登录用户评论带幂等键并刷新详情', async () => {
    loginAsUser();
    // 捕获评论幂等键
    let key = '';
    server.use(
      http.get(/\/api\/v1\/posts\/1$/, () => HttpResponse.json(envelope(detail()))),
      http.post(/\/api\/v1\/posts\/1\/comments$/, ({ request }) => {
        key = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(
          envelope({
            id: 21,
            userId: 1,
            nickname: '学员',
            content: '<p>好文章</p>',
            createdAt: '2026-11-10T00:00:00.000Z',
            replies: [],
          }),
          { status: 201 },
        );
      }),
    );

    renderWithProviders([{ path: '/community/:postId', element: <PostDetailPage /> }], '/community/1');

    await userEvent.type(await screen.findByPlaceholderText('写下你的评论'), '好文章');
    await userEvent.click(screen.getByRole('button', { name: '发表评论' }));

    await waitFor(() => expect(key.length).toBeGreaterThanOrEqual(8));
  });

  it('仅本人内容显示删除入口', async () => {
    loginAsUser();
    server.use(http.get(/\/api\/v1\/posts\/1$/, () => HttpResponse.json(envelope(detail()))));

    renderWithProviders([{ path: '/community/:postId', element: <PostDetailPage /> }], '/community/1');

    // 帖子作者为 userId=1，评论作者为 userId=2
    expect(await screen.findByRole('button', { name: '删除帖子' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除评论' })).not.toBeInTheDocument();
  });
});
