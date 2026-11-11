import { http, HttpResponse } from 'msw';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function mockLearning(options?: { contentStatus?: number }) {
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
      return HttpResponse.json(envelope({ progressPercent: 50, completed: false }));
    }),
  );
  return { visits };
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
    renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/checkout/:courseId', element: <div>checkout-page</div> },
      ],
      '/learning/1',
    );

    expect(await screen.findByText('购买后可学习')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去购买' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看课程详情' })).toBeInTheDocument();
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
