import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimCouponButton } from '@/features/coupon/ClaimCouponButton';
import MyCouponsPage from '@/features/coupon/MyCouponsPage';
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

    await userEvent.click(screen.getByRole('button', { name: '立即领取' }));
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

    await userEvent.click(screen.getByRole('button', { name: '立即领取' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    expect(await screen.findByRole('button', { name: '已领取' })).toBeDisabled();
  });

  it('游客「登录领取」使用橙底白字样式类', () => {
    renderWithProviders(
      [{ path: '/courses/:id', element: <ClaimCouponButton coupon={coupon} courseId={1} /> }],
      '/courses/1',
    );

    // 样式类由 ClaimCouponButton.css 提供（橙底白字）
    expect(screen.getByRole('button', { name: '登录领取' })).toHaveClass('claim-coupon-btn');
  });

  it('登录用户「立即领取」使用橙底白字样式类', () => {
    loginAsUser();
    renderWithProviders(
      [{ path: '/', element: <ClaimCouponButton coupon={coupon} courseId={1} /> }],
      '/',
    );

    // 样式类由 ClaimCouponButton.css 提供（橙底白字）
    expect(screen.getByRole('button', { name: '立即领取' })).toHaveClass('claim-coupon-btn');
  });
});

// 领取记录桩
function claim(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 21,
    templateId: 9,
    templateName: '新学员立减券',
    discountCents: 2000,
    startAt: '2026-11-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
    courseIds: [1],
    status: 'unused',
    claimedAt: '2026-11-10T00:00:00.000Z',
    usedAt: null,
    ...overrides,
  };
}

describe('MyCouponsPage', () => {
  beforeEach(() => loginAsUser());

  it('四个页签按状态请求，单课程跳详情', async () => {
    // 捕获状态参数
    const statuses: string[] = [];
    server.use(
      http.get(/\/api\/v1\/user\/coupons$/, ({ request }) => {
        statuses.push(new URL(request.url).searchParams.get('status') ?? '');
        return HttpResponse.json(
          envelope({ items: [claim()], total: 1, page: 1, pageSize: 20 }),
        );
      }),
    );

    renderWithProviders([{ path: '/user/coupons', element: <MyCouponsPage /> }], '/user/coupons');

    expect(await screen.findByText('新学员立减券')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '去使用' })).toHaveAttribute('href', '/courses/1');
    expect(statuses[0]).toBe('unused');

    await userEvent.click(screen.getByRole('tab', { name: '已使用' }));
    await waitFor(() => expect(statuses).toContain('used'));
  });

  it('多课程券去使用跳课程列表，已使用不提供入口', async () => {
    server.use(
      http.get(/\/api\/v1\/user\/coupons$/, ({ request }) => {
        const status = new URL(request.url).searchParams.get('status');
        return HttpResponse.json(
          envelope({
            items:
              status === 'unused'
                ? [claim({ id: 22, courseIds: [1, 2] })]
                : [claim({ id: 23, status: 'used', usedAt: '2026-11-09T00:00:00.000Z' })],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        );
      }),
    );

    renderWithProviders([{ path: '/user/coupons', element: <MyCouponsPage /> }], '/user/coupons');

    expect(await screen.findByRole('link', { name: '去使用' })).toHaveAttribute('href', '/courses');
    await userEvent.click(screen.getByRole('tab', { name: '已使用' }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: '去使用' })).not.toBeInTheDocument(),
    );
  });
});
