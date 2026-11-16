import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CouponCheckoutPage from '@/features/checkout/CouponCheckoutPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-coupon-checkout' };
}

// 券领取记录桩：默认单课程
function claim(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 9,
    templateId: 3,
    templateName: '满减券',
    discountCents: 500,
    startAt: '2026-11-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
    courseIds: [1],
    courseNames: ['TypeScript 系统入门'],
    status: 'unused',
    claimedAt: '2026-11-10T00:00:00.000Z',
    usedAt: null,
    ...overrides,
  };
}

// 课程详情桩：只提供结算页用到的字段
function course(id: number, name: string, saleCents: number) {
  return {
    id,
    name,
    type: 'video',
    coverKey: null,
    coverUrl: null,
    instructor: '张老师',
    originalCents: saleCents * 2,
    saleCents,
    status: 'published',
    intro: null,
    detailRich: null,
    chapters: [],
  };
}

// 价格预览桩：售价 - 券面额
function preview(courseId: number, currentCents: number) {
  return {
    courseId,
    activityType: 'normal',
    activityId: null,
    originalCents: currentCents * 2,
    currentCents,
    discountCents: 500,
    paidCents: Math.max(0, currentCents - 500),
    couponClaimId: 9,
  };
}

// 订单桩
function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    orderNo: 'ZX202611160001',
    courseId: 1,
    courseName: 'TypeScript 系统入门',
    activityType: 'normal',
    activityId: null,
    originalCents: 19900,
    currentCents: 9900,
    discountCents: 500,
    paidCents: 9400,
    couponClaimId: 9,
    status: 'pending',
    paidAt: null,
    createdAt: '2026-11-16T02:00:00.000Z',
    ...overrides,
  };
}

// 券列表请求桩
function useCouponList(items: unknown[]) {
  server.use(
    http.get(/\/api\/v1\/user\/coupons$/, () =>
      HttpResponse.json(envelope({ items, total: items.length, page: 1, pageSize: 100 })),
    ),
  );
}

describe('CouponCheckoutPage', () => {
  it('单课程券展示产品与抵扣，确认支付创建订单后跳支付页', async () => {
    // 捕获下单请求体
    let payload: Record<string, unknown> | null = null;
    useCouponList([claim()]);
    server.use(
      http.get(/\/api\/v1\/courses\/1$/, () =>
        HttpResponse.json(envelope(course(1, 'TypeScript 系统入门', 9900))),
      ),
      http.get(/\/api\/v1\/checkout\/1\/preview$/, () =>
        HttpResponse.json(envelope(preview(1, 9900))),
      ),
      http.post(/\/api\/v1\/orders$/, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(envelope(order()), { status: 201 });
      }),
    );

    const { router } = renderWithProviders(
      [
        { path: '/checkout/coupon/:couponId', element: <CouponCheckoutPage /> },
        { path: '/order/:id/pay', element: <div>pay-page</div> },
      ],
      '/checkout/coupon/9',
    );

    expect(await screen.findByText('TypeScript 系统入门')).toBeInTheDocument();
    expect(screen.getByText('¥5.00 优惠券')).toBeInTheDocument();
    expect(screen.getByText(/优惠券已抵扣/)).toBeInTheDocument();
    expect(screen.getByText('¥94.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '确认支付' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/order/1/pay'));
    expect(payload).toMatchObject({ courseId: 1, couponClaimId: 9, activityType: 'normal' });
  });

  it('多课程券列出课程，切换课程后重新计价并按所选课程下单', async () => {
    // 捕获下单请求体
    let payload: Record<string, unknown> | null = null;
    useCouponList([
      claim({ courseIds: [1, 2], courseNames: ['TypeScript 系统入门', 'React 实战'] }),
    ]);
    server.use(
      http.get(/\/api\/v1\/courses\/1$/, () =>
        HttpResponse.json(envelope(course(1, 'TypeScript 系统入门', 9900))),
      ),
      http.get(/\/api\/v1\/courses\/2$/, () =>
        HttpResponse.json(envelope(course(2, 'React 实战', 19900))),
      ),
      http.get(/\/api\/v1\/checkout\/1\/preview$/, () =>
        HttpResponse.json(envelope(preview(1, 9900))),
      ),
      http.get(/\/api\/v1\/checkout\/2\/preview$/, ({ request }) => {
        // 第二门课程必须带上券参数
        const couponId = new URL(request.url).searchParams.get('couponId');
        return HttpResponse.json(envelope(preview(2, couponId === '9' ? 19900 : 0)));
      }),
      http.post(/\/api\/v1\/orders$/, async ({ request }) => {
        payload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(envelope(order({ courseId: 2 })), { status: 201 });
      }),
    );

    const { router } = renderWithProviders(
      [
        { path: '/checkout/coupon/:couponId', element: <CouponCheckoutPage /> },
        { path: '/order/:id/pay', element: <div>pay-page</div> },
      ],
      '/checkout/coupon/9',
    );

    // 两门课程都列出，默认选中第一门
    const first = await screen.findByRole('button', { name: /TypeScript 系统入门/ });
    const second = screen.getByRole('button', { name: /React 实战/ });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByText('¥94.00')).toBeInTheDocument();

    await userEvent.click(second);

    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('¥194.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '确认支付' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/order/1/pay'));
    expect(payload).toMatchObject({ courseId: 2, couponClaimId: 9 });
  });

  it('券不在未使用列表时提示不可用', async () => {
    useCouponList([]);

    renderWithProviders(
      [{ path: '/checkout/coupon/:couponId', element: <CouponCheckoutPage /> }],
      '/checkout/coupon/9',
    );

    expect(await screen.findByText('优惠券不可用或已失效')).toBeInTheDocument();
  });
});
