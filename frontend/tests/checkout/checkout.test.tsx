import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CheckoutPage from '@/features/checkout/CheckoutPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-checkout' };
}

function preview(couponId: number | null) {
  return {
    courseId: 1,
    activityType: 'normal',
    activityId: null,
    originalCents: 19900,
    currentCents: 9900,
    discountCents: couponId ? 2000 : 0,
    paidCents: couponId ? 7900 : 9900,
    couponClaimId: couponId,
  };
}

function courseDetail() {
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
    intro: null,
    detailRich: null,
    chapters: [],
  };
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
    status: 'pending',
    paidAt: null,
    createdAt: '2026-11-10T02:00:00.000Z',
    ...overrides,
  };
}

describe('CheckoutPage', () => {
  beforeEach(() => {
    server.use(
      http.get(/\/api\/v1\/courses\/1$/, () => HttpResponse.json(envelope(courseDetail()))),
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
  });

  afterEach(() => {
    useSessionStore.getState().clear();
  });

  it('选券后重新预览并创建订单后跳支付页', async () => {
    let created = 0;
    let idempotencyKey = '';

    server.use(
      http.get(/\/api\/v1\/checkout\/1\/preview$/, ({ request }) => {
        const couponId = new URL(request.url).searchParams.get('couponId');
        return HttpResponse.json(envelope(preview(couponId ? Number(couponId) : null)));
      }),
      http.get(/\/api\/v1\/user\/coupons$/, () =>
        HttpResponse.json(
          envelope({
            items: [
              {
                id: 9,
                templateId: 1,
                templateName: '新学员立减券',
                discountCents: 2000,
                startAt: '2026-11-01T00:00:00.000Z',
                endAt: '2026-12-31T00:00:00.000Z',
                courseIds: [1],
                status: 'unused',
                claimedAt: '2026-11-01T00:00:00.000Z',
                usedAt: null,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 100,
          }),
        ),
      ),
      http.post(/\/api\/v1\/orders$/, ({ request }) => {
        created += 1;
        idempotencyKey = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(envelope(order()), { status: 201 });
      }),
    );

    const { router } = renderWithProviders(
      [
        { path: '/checkout/:courseId', element: <CheckoutPage /> },
        { path: '/order/:id/pay', element: <div>pay-page</div> },
      ],
      '/checkout/1',
    );

    expect((await screen.findAllByText('¥99.00')).length).toBeGreaterThan(0);
    expect(await screen.findByText('产品信息')).toBeInTheDocument();
    expect(await screen.findByText('TypeScript 系统入门')).toBeInTheDocument();
    expect(screen.getByText('视频')).toBeInTheDocument();
    expect(screen.getByText('支付方式')).toBeInTheDocument();
    expect(screen.getByText('微信支付')).toBeInTheDocument();
    expect(screen.getByText('请在30分钟内完成支付')).toBeInTheDocument();
    expect(screen.getByText(/需支付/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText(/新学员立减券/));
    expect(await screen.findByText('¥79.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '确认支付' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/order/1/pay'));
    expect(created).toBe(1);
    expect(idempotencyKey.length).toBeGreaterThanOrEqual(8);
  });

  it('4003 提示已购买并可跳学习页', async () => {
    server.use(
      http.get(/\/api\/v1\/checkout\/1\/preview$/, () => HttpResponse.json(envelope(preview(null)))),
      http.get(/\/api\/v1\/user\/coupons$/, () =>
        HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 100 })),
      ),
      http.post(/\/api\/v1\/orders$/, () =>
        HttpResponse.json(
          { code: 4003, message: '您已购买过该课程', data: null, requestId: 'r-dup' },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(
      [
        { path: '/checkout/:courseId', element: <CheckoutPage /> },
        { path: '/learning/:courseId', element: <div>learning-page</div> },
      ],
      '/checkout/1',
    );

    expect(await screen.findByText('暂无优惠券')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: '确认支付' }));

    expect((await screen.findAllByText('您已购买该课程')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '去学习' })).toHaveAttribute('href', '/learning/1');
  });

  it('4002 券不可用自动清除券并刷新价格', async () => {
    server.use(
      http.get(/\/api\/v1\/checkout\/1\/preview$/, ({ request }) => {
        const couponId = new URL(request.url).searchParams.get('couponId');
        return HttpResponse.json(envelope(preview(couponId ? Number(couponId) : null)));
      }),
      http.get(/\/api\/v1\/user\/coupons$/, () =>
        HttpResponse.json(
          envelope({
            items: [
              {
                id: 9,
                templateId: 1,
                templateName: '新学员立减券',
                discountCents: 2000,
                startAt: '2026-11-01T00:00:00.000Z',
                endAt: '2026-12-31T00:00:00.000Z',
                courseIds: [1],
                status: 'unused',
                claimedAt: '2026-11-01T00:00:00.000Z',
                usedAt: null,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 100,
          }),
        ),
      ),
      http.post(/\/api\/v1\/orders$/, () =>
        HttpResponse.json(
          { code: 4002, message: '优惠券不可用', data: null, requestId: 'r-coupon' },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(
      [{ path: '/checkout/:courseId', element: <CheckoutPage /> }],
      '/checkout/1',
    );

    expect((await screen.findAllByText('¥99.00')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByText(/新学员立减券/));
    expect(await screen.findByText('¥79.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '确认支付' }));

    await waitFor(() => expect(screen.queryByText('¥79.00')).not.toBeInTheDocument());
    expect(await screen.findAllByText('¥99.00')).not.toHaveLength(0);
  });

  it('既有订单模式只进入支付页不创建', async () => {
    let created = 0;
    server.use(
      http.get(/\/api\/v1\/orders\/5$/, () => HttpResponse.json(envelope(order({ id: 5 })))),
      http.post(/\/api\/v1\/orders$/, () => {
        created += 1;
        return HttpResponse.json(envelope(order()), { status: 201 });
      }),
    );

    const { router } = renderWithProviders(
      [
        { path: '/checkout/:courseId', element: <CheckoutPage /> },
        { path: '/order/:id/pay', element: <div>pay-page</div> },
      ],
      '/checkout/1?orderId=5',
    );

    await userEvent.click(await screen.findByRole('button', { name: '确认支付' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/order/5/pay'));
    expect(created).toBe(0);
  });
});
