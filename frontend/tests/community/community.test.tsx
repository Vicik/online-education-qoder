import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedPage from '@/features/community/FeedPage';
import MyPostsPage from '@/features/community/MyPostsPage';
import NewPostPage from '@/features/community/NewPostPage';
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
  beforeEach(() => {
    useSessionStore.setState({ user: null });
    // 侧栏精品推荐：默认空推荐，避免未处理请求
    server.use(
      http.get(/\/api\/v1\/home\/recommendations$/, () =>
        HttpResponse.json(envelope({ courses: [] })),
      ),
    );
  });

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

  it('连续图片归入图集容器', async () => {
    server.use(
      http.get(/\/api\/v1\/posts$/, () =>
        HttpResponse.json(
          envelope({
            items: [
              post({
                content:
                  '<p>图文帖子</p><img src="https://example.com/a.png" alt="图一"><img src="https://example.com/b.png" alt="图二">',
              }),
            ],
            total: 1,
            page: 1,
            pageSize: 10,
          }),
        ),
      ),
    );

    renderWithProviders([{ path: '/community', element: <FeedPage /> }], '/community');

    expect(await screen.findByText('图文帖子')).toBeInTheDocument();
    expect(document.querySelectorAll('.community-post-gallery img')).toHaveLength(2);
  });

  it('正文只展示前 100 字，点击正文进入详情', async () => {
    // 超过预览上限的正文
    const longText = '字'.repeat(150);
    server.use(
      http.get(/\/api\/v1\/posts$/, () =>
        HttpResponse.json(
          envelope({
            items: [post({ content: `<p>${longText}</p>` })],
            total: 1,
            page: 1,
            pageSize: 10,
          }),
        ),
      ),
    );
    const { router } = renderWithProviders(
      [
        { path: '/community', element: <FeedPage /> },
        { path: '/community/:postId', element: <div>post-detail</div> },
      ],
      '/community',
    );

    // 摘要保留前 100 字并补省略号
    const preview = await screen.findByText(`${'字'.repeat(100)}…`);
    expect(screen.queryByText(longText)).not.toBeInTheDocument();

    await userEvent.click(preview);
    await waitFor(() => expect(router.state.location.pathname).toBe('/community/1'));
  });

  it('点击正文图片在当前页弹窗预览', async () => {
    server.use(
      http.get(/\/api\/v1\/posts$/, () =>
        HttpResponse.json(
          envelope({
            items: [
              post({
                content:
                  '<p>图文帖子</p><img src="https://example.com/a.png" alt="风景图">',
              }),
            ],
            total: 1,
            page: 1,
            pageSize: 10,
          }),
        ),
      ),
    );
    const { router } = renderWithProviders(
      [{ path: '/community', element: <FeedPage /> }],
      '/community',
    );

    expect(await screen.findByText('图文帖子')).toBeInTheDocument();
    // 正文中的图片
    const image = document.querySelector('.community-post-gallery img');
    expect(image).not.toBeNull();
    await userEvent.click(image as HTMLImageElement);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/community');
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
        avatarUrl: 'http://localhost:3000/uploadFiles/image/ming.png',
        content: '<p>一级评论</p>',
        createdAt: '2026-11-10T00:00:00.000Z',
        replies: [
          {
            id: 12,
            userId: 3,
            nickname: '小红',
            avatarUrl: 'http://localhost:3000/uploadFiles/image/hong.png',
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
  beforeEach(() => {
    useSessionStore.setState({ user: null });
    // 侧栏精品推荐：默认空推荐，避免未处理请求
    server.use(
      http.get(/\/api\/v1\/home\/recommendations$/, () =>
        HttpResponse.json(envelope({ courses: [] })),
      ),
    );
  });

  it('展示两层评论与回复目标', async () => {
    server.use(http.get(/\/api\/v1\/posts\/1$/, () => HttpResponse.json(envelope(detail()))));

    renderWithProviders([{ path: '/community/:postId', element: <PostDetailPage /> }], '/community/1');

    expect(await screen.findByText('一级评论')).toBeInTheDocument();
    expect(screen.getByText('回复内容')).toBeInTheDocument();
    expect(screen.getByText('@小明')).toBeInTheDocument();
    // 评论与回复都展示评论者头像
    await waitFor(() =>
      expect(document.querySelectorAll('.comment-avatar img')).toHaveLength(2),
    );
    // 头像地址取自接口返回的 avatarUrl
    expect(document.querySelectorAll('.comment-avatar img')[0]).toHaveAttribute(
      'src',
      'http://localhost:3000/uploadFiles/image/ming.png',
    );
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

    await userEvent.type(await screen.findByPlaceholderText('说两句吧~'), '好文章');
    // 第一个「回复」是表单提交按钮，后面才是评论上的回复按钮
    await userEvent.click(screen.getAllByRole('button', { name: '回复' })[0]);

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

describe('NewPostPage', () => {
  beforeEach(() => loginAsUser());

  it('发帖携带幂等键并在成功后进入详情', async () => {
    // 捕获幂等键
    let key = '';
    server.use(
      http.post(/\/api\/v1\/posts$/, ({ request }) => {
        key = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(envelope(post()), { status: 201 });
      }),
    );
    const { router } = renderWithProviders(
      [
        { path: '/community/new', element: <NewPostPage /> },
        { path: '/community/:postId', element: <div>post-detail</div> },
      ],
      '/community/new',
    );

    await userEvent.type(await screen.findByRole('textbox'), '第一帖');
    await userEvent.click(screen.getByRole('button', { name: '发布' }));

    await waitFor(() => expect(key.length).toBeGreaterThanOrEqual(8));
    await waitFor(() => expect(router.state.location.pathname).toBe('/community/1'));
  });

  it('7001 列出全部命中词', async () => {
    server.use(
      http.post(/\/api\/v1\/posts$/, () =>
        HttpResponse.json(
          { code: 7001, message: '内容包含敏感词', data: ['违禁词', 'badword'], requestId: 'r-blocked' },
          { status: 422 },
        ),
      ),
    );

    renderWithProviders([{ path: '/community/new', element: <NewPostPage /> }], '/community/new');

    await userEvent.type(await screen.findByRole('textbox'), '内容');
    await userEvent.click(screen.getByRole('button', { name: '发布' }));

    expect(await screen.findByText(/违禁词/)).toBeInTheDocument();
    expect(screen.getByText(/badword/)).toBeInTheDocument();
  });

  it('正文按行组装为段落并转义标签', async () => {
    // 捕获提交的正文
    let content = '';
    server.use(
      http.post(/\/api\/v1\/posts$/, async ({ request }) => {
        const body = (await request.json()) as { content: string };
        content = body.content;
        return HttpResponse.json(envelope(post()), { status: 201 });
      }),
    );
    renderWithProviders(
      [
        { path: '/community/new', element: <NewPostPage /> },
        { path: '/community/:postId', element: <div>post-detail</div> },
      ],
      '/community/new',
    );

    await userEvent.type(await screen.findByRole('textbox'), '第一行{enter}<b>第二行</b>');
    await userEvent.click(screen.getByRole('button', { name: '发布' }));

    await waitFor(() =>
      expect(content).toBe('<p>第一行</p><p>&lt;b&gt;第二行&lt;/b&gt;</p>'),
    );
  });

  it('正文为空时展示内联错误且不发送', async () => {
    // 发帖请求次数
    let posted = 0;
    server.use(
      http.post(/\/api\/v1\/posts$/, () => {
        posted += 1;
        return HttpResponse.json(envelope(post()), { status: 201 });
      }),
    );
    renderWithProviders([{ path: '/community/new', element: <NewPostPage /> }], '/community/new');

    await userEvent.click(screen.getByRole('button', { name: '发布' }));

    expect(await screen.findByText('帖子内容不能为空')).toBeInTheDocument();
    expect(posted).toBe(0);
  });
});

describe('MyPostsPage', () => {
  beforeEach(() => loginAsUser());

  it('展示本人帖子并可删除', async () => {
    // 删除请求次数
    let deleted = 0;
    server.use(
      http.get(/\/api\/v1\/user\/posts$/, () =>
        HttpResponse.json(envelope({ items: [post()], total: 1, page: 1, pageSize: 10 })),
      ),
      http.delete(/\/api\/v1\/posts\/1$/, () => {
        deleted += 1;
        return HttpResponse.json(envelope(null));
      }),
    );

    renderWithProviders([{ path: '/user/posts', element: <MyPostsPage /> }], '/user/posts');

    expect(await screen.findByText('第一帖')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));
    await waitFor(() => expect(deleted).toBe(1));
  });
});
