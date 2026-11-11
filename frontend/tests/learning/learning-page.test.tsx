import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '@/api/query-keys';
import LearningPage from '@/features/learning/LearningPage';
import { ChapterViewer } from '@/features/learning/ChapterViewer';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-learn' };
}

function courseDetail() {
  return {
    id: 1,
    name: 'TypeScript 系统入门',
    type: 'rich',
    coverKey: null,
    coverUrl: null,
    instructor: '张老师',
    originalCents: 19900,
    saleCents: 9900,
    status: 'published',
    intro: null,
    detailRich: null,
    chapters: [
      { id: 11, title: '第一章 类型系统', contentType: 'rich', sortOrder: 1 },
      { id: 12, title: '第二章 泛型', contentType: 'rich', sortOrder: 2 },
    ],
    groupon: null,
    flashSale: null,
    claimableCoupons: [],
  };
}

function mockLearning(options?: {
  contentStatus?: number;
  visit?: { progressPercent: number; completed: boolean };
}) {
  const visits: string[] = [];
  server.use(
    http.get(/\/api\/v1\/courses\/1$/, () => HttpResponse.json(envelope(courseDetail()))),
    http.get(/\/api\/v1\/user\/study-records$/, () =>
      HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 20 })),
    ),
    http.get(/\/api\/v1\/courses\/1\/chapters\/(\d+)\/content$/, ({ params }) => {
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
          contentType: 'rich',
          content: `<p>正文 ${id}</p>`,
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
  return { visits };
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

  it('默认打开第一章、渲染正文并上报一次访问', async () => {
    const { visits } = mockLearning();
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正文 11')).toBeInTheDocument();
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(visits).toEqual(['11']);
  });

  it('切换章节重新请求正文并上报新章节', async () => {
    const { visits } = mockLearning();
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正文 11')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/第二章 泛型/));

    expect(await screen.findByText('正文 12')).toBeInTheDocument();
    expect(visits).toEqual(['11', '12']);
  });

  it('未购买显示购买后才可学习', async () => {
    mockLearning({ contentStatus: 403 });
    const { router } = renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/checkout/:courseId', element: <div>checkout-page</div> },
      ],
      '/learning/1',
    );

    expect(await screen.findByText('购买后可学习')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看课程详情' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '去购买' }));
    expect(router.state.location.pathname).toBe('/checkout/1');
  });

  it('未购买空态可返回课程详情', async () => {
    mockLearning({ contentStatus: 403 });
    const { router } = renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/courses/:id', element: <div>course-detail</div> },
      ],
      '/learning/1',
    );

    expect(
      await screen.findByText('购买后可学习', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '查看课程详情' }));
    expect(router.state.location.pathname).toBe('/courses/1');
  });

  it('同一章节正文更新后不重复上报', async () => {
    const { visits } = mockLearning();
    const { queryClient } = renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正文 11')).toBeInTheDocument();
    await waitFor(() => expect(visits).toEqual(['11']));

    server.use(
      http.get(/\/api\/v1\/courses\/1\/chapters\/(\d+)\/content$/, () =>
        HttpResponse.json(
          envelope({
            id: 11,
            title: '第一章 类型系统',
            contentType: 'rich',
            content: '<p>正文 11 更新</p>',
            sortOrder: 1,
          }),
        ),
      ),
    );
    await queryClient.refetchQueries({ queryKey: queryKeys.courseContent(1, 11) });

    expect(await screen.findByText('正文 11 更新')).toBeInTheDocument();
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
            contentType: 'rich',
            content: '<p>正文 11</p>',
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
    expect(await screen.findByText('正文 11')).toBeInTheDocument();
    await waitFor(() => expect(visits).toEqual(['11']));
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

    expect(await screen.findByText('正文 12')).toBeInTheDocument();
    expect(await screen.findByText('已学完')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(visits).toEqual(['12']);
  });

  it('首章禁用上一章，上下章按钮切换并各上报一次', async () => {
    const { visits } = mockLearning();
    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正文 11')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一章' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一章' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: '下一章' }));
    expect(await screen.findByText('正文 12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一章' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '上一章' }));
    expect(await screen.findByText('正文 11')).toBeInTheDocument();
    await waitFor(() => expect(visits).toEqual(['11', '12', '11']));
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
  it('视频章节渲染 video 并带上签名地址', () => {
    const { container } = render(
      <ChapterViewer
        content={{ id: 21, contentType: 'video', content: 'https://cdn.example.com/v.mp4' }}
      />,
    );

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'https://cdn.example.com/v.mp4');
    expect(video).toHaveAttribute('controls');
  });

  it('音频章节渲染 audio 并带上签名地址', () => {
    const { container } = render(
      <ChapterViewer
        content={{ id: 22, contentType: 'audio', content: 'https://cdn.example.com/a.mp3' }}
      />,
    );

    const audio = container.querySelector('audio');
    expect(audio).toHaveAttribute('src', 'https://cdn.example.com/a.mp3');
    expect(audio).toHaveAttribute('controls');
  });

  it('正文缺失展示空态', () => {
    render(<ChapterViewer content={{ id: 23, contentType: 'rich' }} />);
    expect(screen.getByText('章节内容暂未上传')).toBeInTheDocument();
  });
});
