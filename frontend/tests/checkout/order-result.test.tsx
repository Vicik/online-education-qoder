import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import OrderResultPage from '@/features/checkout/OrderResultPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-result' };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    orderNo: 'ZX202611100001',
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
    createdAt: '2026-11-10T02:00:00.000Z',
    ...overrides,
  };
}

function renderResult() {
  server.use(http.get(/\/api\/v1\/orders\/1$/, () => HttpResponse.json(envelope(order()))));
  return renderWithProviders(
    [{ path: '/order/:id/result', element: <OrderResultPage /> }],
    '/order/1/result',
  );
}

describe('OrderResultPage', () => {
  it('已支付展示去学习', async () => {
    renderResult();
    expect(await screen.findByText('支付成功')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '去学习' })).toHaveAttribute('href', '/learning/1');
  });

  it('拼团订单待成团提示', async () => {
    server.use(
      http.get(/\/api\/v1\/orders\/1$/, () =>
        HttpResponse.json(envelope(order({ activityType: 'groupon', activityId: 3 }))),
      ),
    );
    renderWithProviders([{ path: '/order/:id/result', element: <OrderResultPage /> }], '/order/1/result');
    expect(await screen.findByText(/拼团待成团/)).toBeInTheDocument();
  });

  it('退款订单显示模拟退款成功', async () => {
    server.use(
      http.get(/\/api\/v1\/orders\/1$/, () =>
        HttpResponse.json(envelope(order({ status: 'refunded' }))),
      ),
    );
    renderWithProviders([{ path: '/order/:id/result', element: <OrderResultPage /> }], '/order/1/result');
    expect(await screen.findByText('退款成功（模拟）')).toBeInTheDocument();
  });

  it('取消订单显示已取消文案', async () => {
    server.use(
      http.get(/\/api\/v1\/orders\/1$/, () =>
        HttpResponse.json(envelope(order({ status: 'cancelled' }))),
      ),
    );
    renderWithProviders([{ path: '/order/:id/result', element: <OrderResultPage /> }], '/order/1/result');
    expect(await screen.findByText('订单已取消')).toBeInTheDocument();
  });
});
