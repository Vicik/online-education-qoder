import { http, HttpResponse } from 'msw';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { queryKeys } from '@/api/query-keys';
import LearningPage from '@/features/learning/LearningPage';
import { ChapterViewer } from '@/features/learning/ChapterViewer';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-learn' };
}

function courseDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'TypeScript 系统入门',
    type: 'audio',
    coverKey: null,
    coverUrl: null,
    instructor: '张老师',
    originalCents: 19900,
    saleCents: 9900,
    status: 'published',
    intro: '从零掌握类型系统',
    detailRich: null,
    chapters: [
      { id: 11, title: '第一章 类型系统', contentType: 'audio', sortOrder: 1, visited: false, isFree: false },
      { id: 12, title: '第二章 泛型', contentType: 'audio', sortOrder: 2, visited: false, isFree: false },
    ],
    groupon: null,
    flashSale: null,
    claimableCoupons: [],
    ...overrides,
  };
}

function mockLearning(options?: {
  contentStatus?: number;
  visit?: { progressPercent: number; completed: boolean };
  purchased?: boolean;
  detail?: Record<string, unknown>;
}) {
  const visits: string[] = [];
  const contentRequests: string[] = [];
  const orders =
    options?.purchased === false
      ? []
      : [
          {
            id: 7,
            orderNo: 'ZX202611100007',
            courseId: 1,
            courseName: 'TypeScript 系统入门',
            activityType: 'normal',
            activityId: null,
            originalCents: 19900,
            currentCents: 9900,
            discountCents: 0,
            paidCents: 9900,
            couponClaimId: null,
            status: 'paid',
            paidAt: '2026-11-10T02:00:00.000Z',
            createdAt: '2026-11-10T01:59:00.000Z',
          },
        ];
  server.use(
    http.get(/\/api\/v1\/courses\/1$/, () =>
      HttpResponse.json(envelope(courseDetail(options?.detail))),
    ),
    http.get(/\/api\/v1\/home\/recommendations$/, () =>
      HttpResponse.json(envelope({ courses: [] })),
    ),
    http.get(/\/api\/v1\/user\/orders$/, () =>
      HttpResponse.json(
        envelope({ items: orders, total: orders.length, page: 1, pageSize: 100 }),
      ),
    ),
    http.get(/\/api\/v1\/user\/study-records$/, () =>
      HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 20 })),
    ),
    http.get(/\/api\/v1\/courses\/1\/chapters\/(\d+)\/content$/, ({ params }) => {
      contentRequests.push(String(params[0]));
      if (options?.contentStatus === 403) {
        return HttpResponse.json(
          { code: 3002, message: '请先购买课程', data: null, requestId: 'r-403' },
          { status: 403 },
        );
      }
      const id = Number(params[0]);
      return HttpResponse.json(
        envelope({
          id,
          title: id === 11 ? '第一章 类型系统' : '第二章 泛型',
          contentType: 'audio',
          content: `https://cdn.example.com/a${id}.mp3`,
          sortOrder: id === 11 ? 1 : 2,
        }),
      );
    }),
    http.post(/\/api\/v1\/learning\/1\/chapters\/(\d+)\/visit$/, ({ params }) => {
      visits.push(String(params[0]));
      return HttpResponse.json(
        envelope(options?.visit ?? { progressPercent: 50, completed: false }),
      );
    }),
  );
  return { visits, contentRequests };
}

function mockRecords(items: Array<Record<string, unknown>>) {
  server.use(
    http.get(/\/api\/v1\/user\/study-records$/, () =>
      HttpResponse.json(
        envelope({ items, total: items.length, page: 1, pageSize: 100 }),
      ),
    ),
  );
}

// 触发隐藏 audio 的播放结束事件
function finishAudio() {
  // 当前隐藏播放器
  const audio = document.querySelector('audio');
  expect(audio).not.toBeNull();
  fireEvent.ended(audio as HTMLAudioElement);
}

describe('LearningPage', () => {
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
    useSessionStore.getState().clear();
  });

  it('默认打开第一章，播放结束才上报一次访问', async () => {
    const { visits } = mockLearning();
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('TypeScript 系统入门')).toBeInTheDocument();
    expect(screen.getByText('正在学习：第一章 类型系统')).toBeInTheDocument();
    expect(visits).toEqual([]);

    finishAudio();
    await waitFor(() => expect(visits).toEqual(['11']));
  });

  it('切换章节重新请求正文，播放结束上报新章节', async () => {
    const { visits } = mockLearning();
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正在学习：第一章 类型系统')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '章节目录' }));
    await userEvent.click(screen.getByText(/第二章 泛型/));

    expect(await screen.findByText('正在学习：第二章 泛型')).toBeInTheDocument();
    finishAudio();
    await waitFor(() => expect(visits).toEqual(['12']));
  });

  it('登录未购显示购买引导且不请求锁定章节正文', async () => {
    const { contentRequests } = mockLearning({ purchased: false });
    const { router } = renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/checkout/:courseId', element: <div>checkout-page</div> },
      ],
      '/learning/1',
    );

    expect(await screen.findByText('购买后可学习')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看课程详情' })).toBeInTheDocument();
    expect(contentRequests).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: '去购买' }));
    expect(router.state.location.pathname).toBe('/checkout/1');
  });

  it('游客可播放免费试看章节且播放结束不上报', async () => {
    useSessionStore.getState().clear();
    const { visits } = mockLearning({
      purchased: false,
      detail: {
        chapters: [
          { id: 11, title: '第一章 类型系统', contentType: 'audio', sortOrder: 1, isFree: true },
          { id: 12, title: '第二章 泛型', contentType: 'audio', sortOrder: 2, isFree: false },
        ],
      },
    });

    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正在学习：第一章 类型系统')).toBeInTheDocument();
    finishAudio();
    expect(visits).toEqual([]);
  });

  it('游客点击锁定章节展示登录引导且不请求正文', async () => {
    useSessionStore.getState().clear();
    const { contentRequests } = mockLearning({ purchased: false });
    const { router } = renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/courses/:id', element: <div>course-detail</div> },
        { path: '/login', element: <div>login-page</div> },
      ],
      '/learning/1?chapterId=12',
    );

    expect(await screen.findByText('登录后可学习')).toBeInTheDocument();
    expect(contentRequests).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: '去登录' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toContain(
      encodeURIComponent('/learning/1?chapterId=12'),
    );
  });

  it('登录未购可播放试看章节并上报', async () => {
    const { visits } = mockLearning({
      purchased: false,
      detail: {
        chapters: [
          { id: 11, title: '第一章 类型系统', contentType: 'audio', sortOrder: 1, isFree: true },
          { id: 12, title: '第二章 泛型', contentType: 'audio', sortOrder: 2, isFree: false },
        ],
      },
    });

    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正在学习：第一章 类型系统')).toBeInTheDocument();
    finishAudio();
    await waitFor(() => expect(visits).toEqual(['11']));
  });

  it('登录未购且课程有秒杀时购买引导进入秒杀详情', async () => {
    mockLearning({
      purchased: false,
      detail: {
        flashSale: {
          id: 5,
          courseId: 1,
          courseName: 'TypeScript 系统入门',
          name: '限时秒杀',
          priceCents: 5900,
          stock: 10,
          sold: 0,
          startAt: '2026-11-01T00:00:00.000Z',
          endAt: '2099-12-01T00:00:00.000Z',
          status: 'ongoing',
        },
      },
    });
    const { router } = renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/flash-sales/:id', element: <div>flash-sale-detail</div> },
      ],
      '/learning/1',
    );

    expect(await screen.findByText('购买后可学习')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '去购买' }));
    expect(router.state.location.pathname).toBe('/flash-sales/5');
  });

  it('未购买空态可返回课程详情', async () => {
    mockLearning({ purchased: false });
    const { router } = renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/courses/:id', element: <div>course-detail</div> },
      ],
      '/learning/1',
    );

    expect(await screen.findByText('购买后可学习')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '查看课程详情' }));
    expect(router.state.location.pathname).toBe('/courses/1');
  });

  it('同一章节重复播放结束不重复上报', async () => {
    const { visits } = mockLearning();
    const { queryClient } = renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正在学习：第一章 类型系统')).toBeInTheDocument();
    finishAudio();
    await waitFor(() => expect(visits).toEqual(['11']));

    await queryClient.refetchQueries({ queryKey: queryKeys.courseContent(1, 11) });
    await screen.findByText('正在学习：第一章 类型系统');

    finishAudio();
    expect(visits).toEqual(['11']);
  });

  it('学习记录未返回前不请求正文，返回后再打开最近章节', async () => {
    const { visits } = mockLearning();
    let courseRequested = false;
    let contentRequested = false;
    let releaseRecords: () => void = () => {};
    const recordsGate = new Promise<void>((resolve) => {
      releaseRecords = resolve;
    });
    server.use(
      http.get(/\/api\/v1\/courses\/1$/, () => {
        courseRequested = true;
        return HttpResponse.json(envelope(courseDetail()));
      }),
      http.get(/\/api\/v1\/courses\/1\/chapters\/(\d+)\/content$/, () => {
        contentRequested = true;
        return HttpResponse.json(
          envelope({
            id: 11,
            title: '第一章 类型系统',
            contentType: 'audio',
            content: 'https://cdn.example.com/a11.mp3',
            sortOrder: 1,
          }),
        );
      }),
      http.get(/\/api\/v1\/user\/study-records$/, async () => {
        await recordsGate;
        return HttpResponse.json(
          envelope({ items: [], total: 0, page: 1, pageSize: 100 }),
        );
      }),
    );
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    await waitFor(() => expect(courseRequested).toBe(true));
    expect(contentRequested).toBe(false);
    expect(visits).toEqual([]);

    releaseRecords();
    expect(await screen.findByText('正在学习：第一章 类型系统')).toBeInTheDocument();
    expect(visits).toEqual([]);
  });

  it('课程无章节且学习记录未返回时保持加载态', async () => {
    mockLearning();
    let courseRequested = false;
    let releaseRecords: () => void = () => {};
    const recordsGate = new Promise<void>((resolve) => {
      releaseRecords = resolve;
    });
    server.use(
      http.get(/\/api\/v1\/courses\/1$/, () => {
        courseRequested = true;
        return HttpResponse.json(envelope({ ...courseDetail(), chapters: [] }));
      }),
      http.get(/\/api\/v1\/user\/study-records$/, async () => {
        await recordsGate;
        return HttpResponse.json(
          envelope({ items: [], total: 0, page: 1, pageSize: 100 }),
        );
      }),
    );
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    await waitFor(() => expect(courseRequested).toBe(true));
    await waitFor(() => expect(document.querySelector('.ant-skeleton')).toBeInTheDocument());
    expect(screen.queryByText('暂无章节')).not.toBeInTheDocument();
    expect(screen.queryByText('章节目录')).not.toBeInTheDocument();

    releaseRecords();
    expect(await screen.findByText('暂无章节')).toBeInTheDocument();
    expect(screen.getByText('章节目录')).toBeInTheDocument();
  });

  it('无 URL 章节时恢复学习记录中的最近章节并回填进度', async () => {
    const { visits } = mockLearning({ visit: { progressPercent: 100, completed: true } });
    mockRecords([
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
    ]);
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正在学习：第二章 泛型')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: '章节目录' }));
    expect(await screen.findByText('已学完')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(visits).toEqual([]);
  });

  it('课程不存在时展示空态且不请求正文', async () => {
    const { visits } = mockLearning();
    server.use(
      http.get(/\/api\/v1\/courses\/1$/, () =>
        HttpResponse.json(
          { code: 3001, message: '课程不存在', data: null, requestId: 'r-3001' },
          { status: 404 },
        ),
      ),
    );
    const { router } = renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/courses', element: <div>course-list</div> },
      ],
      '/learning/1',
    );

    expect(await screen.findByText('课程不存在或已下架')).toBeInTheDocument();
    expect(visits).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: '返回课程列表' }));
    expect(router.state.location.pathname).toBe('/courses');
  });

  it('正文非 3002 错误时展示接口信息', async () => {
    const { visits } = mockLearning();
    server.use(
      http.get(/\/api\/v1\/courses\/1\/chapters\/(\d+)\/content$/, () =>
        HttpResponse.json(
          { code: 1006, message: '正文加载失败', data: null, requestId: 'r-500' },
          { status: 500 },
        ),
      ),
    );
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正文加载失败')).toBeInTheDocument();
    expect(visits).toEqual([]);
  });

  it('课程无章节时展示暂无章节', async () => {
    mockLearning();
    server.use(
      http.get(/\/api\/v1\/courses\/1$/, () =>
        HttpResponse.json(envelope({ ...courseDetail(), chapters: [] })),
      ),
    );
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('暂无章节')).toBeInTheDocument();
  });

  it('非法课程 id 不发请求并展示课程不存在', async () => {
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/abc',
    );

    expect(await screen.findByText('课程不存在或已下架')).toBeInTheDocument();
  });
});

describe('ChapterViewer', () => {
  it('视频章节渲染 video 并带上签名地址，播放结束回调', () => {
    // 播放结束回调计数
    const onEnded = vi.fn();
    const { container } = render(
      <ChapterViewer
        content={{ id: 21, contentType: 'video', content: 'https://cdn.example.com/v.mp4' }}
        onEnded={onEnded}
      />,
    );

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'https://cdn.example.com/v.mp4');
    expect(video).toHaveAttribute('controls');

    fireEvent.ended(video as HTMLVideoElement);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('音频章节渲染自定义窄条与隐藏 audio', () => {
    // 播放结束回调计数
    const onEnded = vi.fn();
    const { container } = render(
      <ChapterViewer
        content={{ id: 22, contentType: 'audio', content: 'https://cdn.example.com/a.mp3' }}
        courseName="TypeScript 系统入门"
        chapterTitle="第一章 类型系统"
        onEnded={onEnded}
      />,
    );

    const audio = container.querySelector('audio');
    expect(audio).toHaveAttribute('src', 'https://cdn.example.com/a.mp3');
    expect(screen.getByText('TypeScript 系统入门')).toBeInTheDocument();
    expect(screen.getByText('正在学习：第一章 类型系统')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();

    fireEvent.ended(audio as HTMLAudioElement);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('正文缺失展示空态', () => {
    render(<ChapterViewer content={{ id: 23, contentType: 'audio' }} />);
    expect(screen.getByText('章节内容暂未上传')).toBeInTheDocument();
  });
});
