import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimCouponButton } from '@/features/coupon/ClaimCouponButton';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-coupon-ui' };
}

// 可领券模板
const coupon = {
  id: 9,
  name: '新学员立减券',
  discountCents: 2000,
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-12-31T00:00:00.000Z',
  totalQty: 100,
  claimedCount: 3,
  status: 'enabled' as const,
  courseIds: [1],
};

// 登录普通用户
function loginAsUser() {
  useSessionStore.setState({
    user: {
      id: 1,
      email: 'u@example.com',
      nickname: '学员',
      role: 'user',
      avatarKey: null,
      avatarUrl: null,
      gender: 'secret',
    },
  });
}

describe('ClaimCouponButton', () => {
  beforeEach(() => useSessionStore.setState({ user: null }));

  it('游客点击跳登录并回跳课程详情', async () => {
    const { router } = renderWithProviders(
      [{ path: '/courses/:id', element: <ClaimCouponButton coupon={coupon} courseId={1} /> }],
      '/courses/1',
    );

    await userEvent.click(screen.getByRole('button', { name: '登录领取' }));
    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        '/login?redirect=%2Fcourses%2F1',
      ),
    );
  });

  it('登录用户领取带幂等键并标记已领取', async () => {
    loginAsUser();
    // 捕获幂等键
    let key = '';
    server.use(
      http.post(/\/api\/v1\/coupons\/9\/claim$/, ({ request }) => {
        key = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(
          envelope({
            ...coupon,
            id: 21,
            templateId: 9,
            templateName: coupon.name,
            claimedAt: '2026-11-10T00:00:00.000Z',
            usedAt: null,
            status: 'unused',
          }),
          { status: 201 },
        );
      }),
    );

    renderWithProviders(
      [{ path: '/', element: <ClaimCouponButton coupon={coupon} courseId={1} /> }],
      '/',
    );

    await userEvent.click(screen.getByRole('button', { name: '领取' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(key.length).toBeGreaterThanOrEqual(8));
    expect(await screen.findByRole('button', { name: '已领取' })).toBeDisabled();
  });

  it('409 视为已领取', async () => {
    loginAsUser();
    server.use(
      http.post(/\/api\/v1\/coupons\/9\/claim$/, () =>
        HttpResponse.json(
          { code: 1001, message: '该优惠券每人限领一张', data: null, requestId: 'r-dup' },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(
      [{ path: '/', element: <ClaimCouponButton coupon={coupon} courseId={1} /> }],
      '/',
    );

    await userEvent.click(screen.getByRole('button', { name: '领取' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    expect(await screen.findByRole('button', { name: '已领取' })).toBeDisabled();
  });
});
