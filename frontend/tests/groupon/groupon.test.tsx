import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GrouponDetailPage from '@/features/groupon/GrouponDetailPage';
import GrouponListPage from '@/features/groupon/GrouponListPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-groupon-ui' };
}

// 进行中活动
const activity = {
  id: 3,
  courseId: 1,
  courseName: 'TypeScript 系统入门',
  name: '双人成团',
  priceCents: 6900,
  targetSize: 2,
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2099-12-01T00:00:00.000Z',
  status: 'ongoing',
};

describe('GrouponListPage', () => {
  it('展示进行中活动与服务端倒计时', async () => {
    server.use(
      http.get(/\/api\/v1\/groupons$/, () =>
        HttpResponse.json(envelope({ items: [activity], total: 1, page: 1, pageSize: 12 })),
      ),
    );

    renderWithProviders([{ path: '/groupons', element: <GrouponListPage /> }], '/groupons');

    expect(await screen.findByText('双人成团')).toBeInTheDocument();
    expect(screen.getByText('¥69.00')).toBeInTheDocument();
    expect(screen.getByText(/距结束/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /双人成团/ })).toHaveAttribute('href', '/groupons/3');
  });

  it('空数据显示空态', async () => {
    server.use(
      http.get(/\/api\/v1\/groupons$/, () =>
        HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 12 })),
      ),
    );

    renderWithProviders([{ path: '/groupons', element: <GrouponListPage /> }], '/groupons');
    expect(await screen.findByText('暂无进行中的拼团活动')).toBeInTheDocument();
  });
});

// 团组桩
const group = {
  id: 8,
  status: 'pending',
  memberCount: 1,
  targetSize: 2,
  expiresAt: '2099-12-01T00:00:00.000Z',
  formedAt: null,
};

// 订单桩
const order = {
  id: 5,
  orderNo: 'NO5',
  courseId: 1,
  courseName: 'TypeScript 系统入门',
  activityType: 'groupon',
  activityId: 8,
  originalCents: 19900,
  currentCents: 6900,
  discountCents: 0,
  paidCents: 6900,
  couponClaimId: null,
  status: 'pending',
  paidAt: null,
  createdAt: '2026-11-10T00:00:00.000Z',
};

// 登录普通用户
function loginAsUser() {
  useSessionStore.setState({
    user: { id: 1, email: 'u@example.com', nickname: '学员', role: 'user', avatarKey: null, avatarUrl: null, gender: 'secret' },
  });
}

describe('GrouponDetailPage', () => {
  beforeEach(() => useSessionStore.setState({ user: null }));

  it('游客点发起新团跳登录并回跳', async () => {
    server.use(
      http.get(/\/api\/v1\/groupons\/3$/, () =>
        HttpResponse.json(envelope({ ...activity, groups: [group] })),
      ),
    );
    const { router } = renderWithProviders(
      [{ path: '/groupons/:id', element: <GrouponDetailPage /> }],
      '/groupons/3',
    );

    await userEvent.click(await screen.findByRole('button', { name: '发起新团' }));
    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        '/login?redirect=%2Fgroupons%2F3',
      ),
    );
  });

  it('登录用户开团带幂等键并进入既有订单支付', async () => {
    loginAsUser();
    // 捕获幂等键
    let key = '';
    server.use(
      http.get(/\/api\/v1\/groupons\/3$/, () =>
        HttpResponse.json(envelope({ ...activity, groups: [group] })),
      ),
      http.post(/\/api\/v1\/groupons\/3\/groups$/, ({ request }) => {
        key = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(envelope({ order, group }), { status: 201 });
      }),
    );
    const { router } = renderWithProviders(
      [
        { path: '/groupons/:id', element: <GrouponDetailPage /> },
        { path: '/checkout/:courseId', element: <div>checkout-page</div> },
      ],
      '/groupons/3',
    );

    await userEvent.click(await screen.findByRole('button', { name: '发起新团' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(key.length).toBeGreaterThanOrEqual(8));
    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        '/checkout/1?orderId=5',
      ),
    );
  });

  it('参团调用加入接口并进入既有订单支付', async () => {
    loginAsUser();
    // 捕获参团请求
    let joined = 0;
    server.use(
      http.get(/\/api\/v1\/groupons\/3$/, () =>
        HttpResponse.json(envelope({ ...activity, groups: [group] })),
      ),
      http.post(/\/api\/v1\/groupons\/3\/groups\/8\/join$/, () => {
        joined += 1;
        return HttpResponse.json(envelope({ order, group }), { status: 201 });
      }),
    );
    const { router } = renderWithProviders(
      [
        { path: '/groupons/:id', element: <GrouponDetailPage /> },
        { path: '/checkout/:courseId', element: <div>checkout-page</div> },
      ],
      '/groupons/3',
    );

    await userEvent.click(await screen.findByRole('button', { name: '参团' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(joined).toBe(1));
    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        '/checkout/1?orderId=5',
      ),
    );
  });

  it('满员团组参团按钮禁用', async () => {
    loginAsUser();
    server.use(
      http.get(/\/api\/v1\/groupons\/3$/, () =>
        HttpResponse.json(
          envelope({ ...activity, groups: [{ ...group, memberCount: 2 }] }),
        ),
      ),
    );
    renderWithProviders(
      [{ path: '/groupons/:id', element: <GrouponDetailPage /> }],
      '/groupons/3',
    );

    expect(await screen.findByRole('button', { name: '参团' })).toBeDisabled();
  });

  it('已参与提示并回显后端文案', async () => {
    loginAsUser();
    server.use(
      http.get(/\/api\/v1\/groupons\/3$/, () =>
        HttpResponse.json(envelope({ ...activity, groups: [group] })),
      ),
      http.post(/\/api\/v1\/groupons\/3\/groups\/8\/join$/, () =>
        HttpResponse.json(
          { code: 5001, message: '您已参与过该拼团活动', data: null, requestId: 'r-dup' },
          { status: 409 },
        ),
      ),
    );
    renderWithProviders(
      [{ path: '/groupons/:id', element: <GrouponDetailPage /> }],
      '/groupons/3',
    );

    await userEvent.click(await screen.findByRole('button', { name: '参团' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    expect(await screen.findByText('您已参与过该拼团活动')).toBeInTheDocument();
  });
});
