import { http, HttpResponse } from 'msw';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { queryKeys } from '@/api/query-keys';
import OrderPayPage from '@/features/checkout/OrderPayPage';
import OrderResultPage from '@/features/checkout/OrderResultPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-pay' };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    orderNo: 'ZX202611110001',
    courseId: 1,
    courseName: 'TypeScript 系统入门',
    activityType: 'normal',
    activityId: null,
    originalCents: 19900,
    currentCents: 9900,
    discountCents: 0,
    paidCents: 9900,
    couponClaimId: null,
    status: 'pending',
    paidAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('OrderPayPage', () => {
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
    // 先卸载组件再清空登录态，避免已挂载组件在 act 外更新
    cleanup();
    useSessionStore.getState().clear();
  });

  it('展示微信支付二维码，模拟支付成功后跳转结果页', async () => {
    let paid = 0;
    server.use(
      http.get(/\/api\/v1\/orders\/1$/, () =>
        HttpResponse.json(
          envelope(order(paid > 0 ? { status: 'paid' } : {})),
        ),
      ),
      http.post(/\/api\/v1\/orders\/1\/pay$/, () => {
        paid += 1;
        return HttpResponse.json(envelope(order({ status: 'paid' })));
      }),
    );

    const { router, queryClient } = renderWithProviders(
      [
        { path: '/order/:id/pay', element: <OrderPayPage /> },
        { path: '/order/:id/result', element: <OrderResultPage /> },
      ],
      '/order/1/pay',
    );

    expect(await screen.findByText('微信支付')).toBeInTheDocument();
    expect(screen.getByText(/距离二维码过期还剩/)).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText('¥99.00')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: '支付二维码' })).toBeInTheDocument();
    expect(screen.getByText('请使用微信扫一扫')).toBeInTheDocument();

    expect(await screen.findByText('支付成功', undefined, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/order/1/result'), {
      timeout: 5000,
    });
    expect(paid).toBe(1);
    // 结果页复用订单缓存：缓存必须已更新为已支付
    expect(queryClient.getQueryData<{ status?: string }>(queryKeys.order(1))?.status).toBe('paid');
    expect(await screen.findByText('支付成功')).toBeInTheDocument();
    expect(screen.queryByText('订单待支付')).not.toBeInTheDocument();
  });

  it('支付失败展示错误并可重试', async () => {
    server.use(
      http.get(/\/api\/v1\/orders\/1$/, () => HttpResponse.json(envelope(order()))),
      http.post(/\/api\/v1\/orders\/1\/pay$/, () =>
        HttpResponse.json(
          { code: 5003, message: '支付失败，请稍后重试', data: null, requestId: 'r-pay-fail' },
          { status: 500 },
        ),
      ),
    );

    const { router } = renderWithProviders(
      [{ path: '/order/:id/pay', element: <OrderPayPage /> }],
      '/order/1/pay',
    );

    expect(
      await screen.findByText('支付失败，请稍后重试', undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新支付' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/order/1/pay');
  });
});
