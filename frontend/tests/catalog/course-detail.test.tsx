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

// 我的券领取记录桩：登录后用于判断券是否已领取
function mockMyCoupons(items: () => unknown[]) {
  server.use(
    http.get(/\/api\/v1\/user\/coupons$/, () => {
      const rows = items();
      return HttpResponse.json(
        envelope({ items: rows, total: rows.length, page: 1, pageSize: 100 }),
      );
    }),
  );
}

// 领取记录桩数据
function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: 21,
    templateId: 9,
    templateName: '新学员立减券',
    discountCents: 2000,
    startAt: '2026-11-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
    courseIds: [1],
    status: 'unused',
    claimKey: 'template:9:user:2',
    claimedAt: '2026-11-10T00:00:00.000Z',
    usedAt: null,
    ...overrides,
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

// 购买记录桩：详情页据此判断当前课程是否已购
function mockOrders(items: unknown[]) {
  server.use(
    http.get(/\/api\/v1\/user\/orders$/, () =>
      HttpResponse.json(envelope({ items, total: items.length, page: 1, pageSize: 100 })),
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
    mockMyCoupons(() => []);
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

  it('已领取的券展示已领取', async () => {
    mockDetail();
    mockFavoriteIds();
    mockOrders([]);
    mockMyCoupons(() => [claim()]);
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

    renderWithProviders([{ path: '/courses/:id', element: <CourseDetailPage /> }], '/courses/1');

    await userEvent.click(await screen.findByRole('button', { name: '领取优惠券' }));
    expect(await screen.findByText('已领取')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '去领取' })).not.toBeInTheDocument();
  });

  it('未领取的券可去领取，成功后变为已领取', async () => {
    mockDetail();
    mockFavoriteIds();
    mockOrders([]);
    let claimed = false;
    let claimKey: string | null = null;
    mockMyCoupons(() => (claimed ? [claim()] : []));
    server.use(
      http.post(/\/api\/v1\/coupons\/9\/claim$/, ({ request }) => {
        claimKey = request.headers.get('Idempotency-Key');
        claimed = true;
        return HttpResponse.json(envelope(claim()), { status: 201 });
      }),
    );
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

    renderWithProviders([{ path: '/courses/:id', element: <CourseDetailPage /> }], '/courses/1');

    await userEvent.click(await screen.findByRole('button', { name: '领取优惠券' }));
    await userEvent.click(await screen.findByRole('button', { name: '去领取' }));

    expect(await screen.findByText('领取成功')).toBeInTheDocument();
    expect(await screen.findByText('已领取')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '去领取' })).not.toBeInTheDocument();
    expect(claimKey).toBeTruthy();
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
    mockOrders([]);
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

  it('已购用户显示去学习并进入学习页', async () => {
    mockDetail();
    mockFavoriteIds();
    mockOrders([
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
    ]);
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
        { path: '/learning/:courseId', element: <div>learning-page</div> },
      ],
      '/courses/1',
    );

    const cta = await screen.findByRole('button', { name: '去学习' });
    expect(screen.queryByText('已购买？去学习')).not.toBeInTheDocument();

    await userEvent.click(cta);
    await waitFor(() => expect(router.state.location.pathname).toBe('/learning/1'));
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
