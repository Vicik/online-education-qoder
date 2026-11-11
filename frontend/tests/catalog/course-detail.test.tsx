import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CourseDetailPage from '@/features/catalog/CourseDetailPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-detail' };
}

// 详情桩：含活动、可领券、两个章节
function detail() {
  return {
    id: 1,
    name: 'TypeScript 系统入门',
    type: 'video',
    coverKey: null,
    coverUrl: null,
    instructor: '张老师',
    originalCents: 19900,
    saleCents: 9900,
    status: 'published',
    intro: '从零开始',
    detailRich: '<p>详细介绍</p>',
    chapters: [
      { id: 11, title: '第一章 类型系统', contentType: 'video', sortOrder: 1 },
      { id: 12, title: '第二章 泛型', contentType: 'video', sortOrder: 2 },
    ],
    groupon: {
      id: 3,
      courseId: 1,
      courseName: 'TypeScript 系统入门',
      name: '双人成团',
      priceCents: 6900,
      targetSize: 2,
      startAt: '2026-11-01T00:00:00.000Z',
      endAt: '2026-12-01T00:00:00.000Z',
      status: 'ongoing',
    },
    flashSale: null,
    claimableCoupons: [
      {
        id: 9,
        name: '新学员立减券',
        discountCents: 2000,
        startAt: '2026-11-01T00:00:00.000Z',
        endAt: '2026-12-31T00:00:00.000Z',
        totalQty: 100,
        claimedCount: 1,
        status: 'enabled',
        courseIds: [1],
      },
    ],
  };
}

// 详情接口桩
function mockDetail() {
  server.use(
    http.get(/\/api\/v1\/courses\/1$/, () => HttpResponse.json(envelope(detail()))),
  );
}

// 收藏 id 全集桩：已登录页面会请求
function mockFavoriteIds() {
  server.use(
    http.get(/\/api\/v1\/user\/favorites$/, () =>
      HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 100 })),
    ),
  );
}

// 推荐位桩：右侧精品推荐会请求，排除当前课程后展示
function mockRecommendations() {
  server.use(
    http.get(/\/api\/v1\/home\/recommendations$/, () =>
      HttpResponse.json(
        envelope({
          courses: [
            {
              id: 2,
              name: '推荐课程甲',
              type: 'video',
              coverKey: null,
              coverUrl: null,
              instructor: '李老师',
              originalCents: 19900,
              saleCents: 9900,
              status: 'published',
            },
          ],
        }),
      ),
    ),
  );
}

describe('CourseDetailPage', () => {
  beforeEach(() => {
    mockRecommendations();
  });

  afterEach(() => {
    useSessionStore.getState().clear();
  });

  it('渲染活动、课程概述与章节目录页签', async () => {
    mockDetail();
    renderWithProviders([{ path: '/courses/:id', element: <CourseDetailPage /> }], '/courses/1');

    expect(await screen.findByText('双人成团')).toBeInTheDocument();
    expect(screen.getByText('详细介绍')).toBeInTheDocument();
    expect(screen.queryByText(/第一章 类型系统/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: '章节目录' }));
    expect(await screen.findByText(/第一章 类型系统/)).toBeInTheDocument();
  });

  it('点击领取优惠券才弹出券卡', async () => {
    mockDetail();
    renderWithProviders([{ path: '/courses/:id', element: <CourseDetailPage /> }], '/courses/1');

    expect(await screen.findByText('详细介绍')).toBeInTheDocument();
    expect(screen.queryByText(/新学员立减券/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '领取优惠券' }));
    expect(await screen.findByText(/新学员立减券/)).toBeInTheDocument();
  });

  it('右侧精品推荐展示非当前课程', async () => {
    mockDetail();
    renderWithProviders([{ path: '/courses/:id', element: <CourseDetailPage /> }], '/courses/1');

    expect(await screen.findByText('精品推荐')).toBeInTheDocument();
    expect(await screen.findByText('推荐课程甲')).toBeInTheDocument();
  });

  it('游客点立即学习跳登录并带 redirect', async () => {
    mockDetail();
    const { router } = renderWithProviders(
      [
        { path: '/courses/:id', element: <CourseDetailPage /> },
        { path: '/login', element: <div>login-page</div> },
      ],
      '/courses/1',
    );

    await userEvent.click(await screen.findByRole('button', { name: '立即学习' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(router.state.location.search).toBe('?redirect=%2Fcourses%2F1');
  });

  it('普通用户点立即购买进结算页', async () => {
    mockDetail();
    mockFavoriteIds();
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

    const { router } = renderWithProviders(
      [
        { path: '/courses/:id', element: <CourseDetailPage /> },
        { path: '/checkout/:courseId', element: <div>checkout-page</div> },
      ],
      '/courses/1',
    );

    await userEvent.click(await screen.findByRole('button', { name: '立即购买' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/checkout/1');
    });
  });

  it('3001 显示课程不存在空态', async () => {
    server.use(
      http.get(/\/api\/v1\/courses\/99$/, () =>
        HttpResponse.json(
          { code: 3001, message: '课程不存在', data: null, requestId: 'r-404' },
          { status: 404 },
        ),
      ),
    );

    renderWithProviders([{ path: '/courses/:id', element: <CourseDetailPage /> }], '/courses/99');
    expect(await screen.findByText('课程不存在或已下架')).toBeInTheDocument();
  });
});
