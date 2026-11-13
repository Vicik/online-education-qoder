import { http, HttpResponse } from 'msw';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlashSaleDetailPage from '@/features/flash-sale/FlashSaleDetailPage';
import FlashSaleListPage from '@/features/flash-sale/FlashSaleListPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-flash-ui' };
}

// 秒杀活动桩
const sale = {
  id: 6,
  courseId: 1,
  courseName: 'TypeScript 系统入门',
  // 课程原价：用于划线原价展示
  courseOriginalCents: 19900,
  name: '限时秒杀',
  priceCents: 4900,
  stock: 100,
  sold: 97,
  remaining: 2,
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2099-12-01T00:00:00.000Z',
  status: 'ongoing',
  version: 1,
};

describe('FlashSaleListPage', () => {
  it('展示课程卡片、秒杀价状态与倒计时', async () => {
    server.use(
      http.get(/\/api\/v1\/flash-sales$/, () =>
        HttpResponse.json(envelope({ items: [sale], total: 1, page: 1, pageSize: 12 })),
      ),
    );

    renderWithProviders([{ path: '/flash-sales', element: <FlashSaleListPage /> }], '/flash-sales');

    expect(await screen.findByText('TypeScript 系统入门')).toBeInTheDocument();
    expect(screen.getByText('¥49.00')).toBeInTheDocument();
    expect(screen.getByText('秒杀中')).toBeInTheDocument();
    expect(screen.getByText('倒计时')).toBeInTheDocument();
    // 整卡跳课程详情页
    expect(screen.getByRole('link')).toHaveAttribute('href', '/courses/1?from=flash');
  });

  it('页脚为参考图橙色，划线原价下移 5px', async () => {
    server.use(
      http.get(/\/api\/v1\/flash-sales$/, () =>
        HttpResponse.json(envelope({ items: [sale], total: 1, page: 1, pageSize: 12 })),
      ),
    );

    renderWithProviders([{ path: '/flash-sales', element: <FlashSaleListPage /> }], '/flash-sales');

    // 页脚：与拼团、参考图一致的橙色
    const footer = (await screen.findByText('秒杀中')).closest('.activity-card-footer');
    expect(footer).not.toBeNull();
    expect(footer).toHaveStyle({ backgroundColor: 'rgb(250, 140, 22)' });

    // 原价：相对活动价下移 5px，与课程卡片一致
    const original = document.querySelector('.activity-card-price .money-text-original');
    expect(original).not.toBeNull();
    const style = getComputedStyle(original as Element);
    expect(style.position).toBe('relative');
    expect(style.top).toBe('5px');
  });

  it('售罄活动显示已售罄', async () => {
    server.use(
      http.get(/\/api\/v1\/flash-sales$/, () =>
        HttpResponse.json(
          envelope({ items: [{ ...sale, remaining: 0 }], total: 1, page: 1, pageSize: 12 }),
        ),
      ),
    );

    renderWithProviders([{ path: '/flash-sales', element: <FlashSaleListPage /> }], '/flash-sales');
    expect(await screen.findByText('已售罄')).toBeInTheDocument();
  });

  it('空数据显示空态', async () => {
    server.use(
      http.get(/\/api\/v1\/flash-sales$/, () =>
        HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 12 })),
      ),
    );

    renderWithProviders([{ path: '/flash-sales', element: <FlashSaleListPage /> }], '/flash-sales');
    expect(await screen.findByText('暂无秒杀活动')).toBeInTheDocument();
  });
});

// 订单桩
const order = {
  id: 7,
  orderNo: 'NO7',
  courseId: 1,
  courseName: 'TypeScript 系统入门',
  activityType: 'flash_sale',
  activityId: 6,
  originalCents: 19900,
  currentCents: 4900,
  discountCents: 0,
  paidCents: 4900,
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

describe('FlashSaleDetailPage', () => {
  beforeEach(() => useSessionStore.setState({ user: null }));

  it('游客点抢购跳登录并回跳', async () => {
    server.use(
      http.get(/\/api\/v1\/flash-sales\/6$/, () => HttpResponse.json(envelope(sale))),
    );
    const { router } = renderWithProviders(
      [{ path: '/flash-sales/:id', element: <FlashSaleDetailPage /> }],
      '/flash-sales/6',
    );

    await userEvent.click(await screen.findByRole('button', { name: '立即抢购' }));
    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        '/login?redirect=%2Fflash-sales%2F6',
      ),
    );
  });

  it('登录用户抢购带幂等键并进入既有订单支付', async () => {
    loginAsUser();
    // 捕获幂等键
    let key = '';
    server.use(
      http.get(/\/api\/v1\/flash-sales\/6$/, () => HttpResponse.json(envelope(sale))),
      http.post(/\/api\/v1\/flash-sales\/6\/purchase$/, ({ request }) => {
        key = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(envelope({ order }), { status: 201 });
      }),
    );
    const { router } = renderWithProviders(
      [
        { path: '/flash-sales/:id', element: <FlashSaleDetailPage /> },
        { path: '/checkout/:courseId', element: <div>checkout-page</div> },
      ],
      '/flash-sales/6',
    );

    await userEvent.click(await screen.findByRole('button', { name: '立即抢购' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(key.length).toBeGreaterThanOrEqual(8));
    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        '/checkout/1?orderId=7',
      ),
    );
  });

  it('售罄与未开始按钮禁用', async () => {
    loginAsUser();
    server.use(
      http.get(/\/api\/v1\/flash-sales\/6$/, () =>
        HttpResponse.json(envelope({ ...sale, remaining: 0 })),
      ),
    );
    renderWithProviders(
      [{ path: '/flash-sales/:id', element: <FlashSaleDetailPage /> }],
      '/flash-sales/6',
    );

    expect(await screen.findByRole('button', { name: '已售罄' })).toBeDisabled();
    cleanup();

    server.use(
      http.get(/\/api\/v1\/flash-sales\/6$/, () =>
        HttpResponse.json(
          envelope({ ...sale, status: 'not_started', startAt: '2099-01-01T00:00:00.000Z' }),
        ),
      ),
    );
    renderWithProviders(
      [{ path: '/flash-sales/:id', element: <FlashSaleDetailPage /> }],
      '/flash-sales/6',
    );
    expect(await screen.findByRole('button', { name: '未开始' })).toBeDisabled();
  });

  it('限购一次提示后不跳转', async () => {
    loginAsUser();
    server.use(
      http.get(/\/api\/v1\/flash-sales\/6$/, () => HttpResponse.json(envelope(sale))),
      http.post(/\/api\/v1\/flash-sales\/6\/purchase$/, () =>
        HttpResponse.json(
          { code: 5003, message: '同一活动限购一次', data: null, requestId: 'r-limit' },
          { status: 409 },
        ),
      ),
    );
    const { router } = renderWithProviders(
      [{ path: '/flash-sales/:id', element: <FlashSaleDetailPage /> }],
      '/flash-sales/6',
    );

    await userEvent.click(await screen.findByRole('button', { name: '立即抢购' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    expect(await screen.findByText('同一活动限购一次')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/flash-sales/6');
  });
});
