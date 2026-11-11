import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import OverviewPage from '@/features/user-center/OverviewPage';
import OrdersPage from '@/features/user-center/OrdersPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-center' };
}

describe('user center', () => {
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
    useSessionStore.getState().clear();
  });

  it('概览展示五项统计', async () => {
    server.use(
      http.get(/\/api\/v1\/user\/overview$/, () =>
        HttpResponse.json(
          envelope({
            enrolledCount: 2,
            completedCount: 1,
            favoriteCount: 3,
            couponCount: 4,
            postCount: 5,
          }),
        ),
      ),
    );

    renderWithProviders([{ path: '/user', element: <OverviewPage /> }], '/user');
    expect(await screen.findByText('已购课程')).toBeInTheDocument();
    expect(screen.getByText('已学完')).toBeInTheDocument();
    expect(screen.getByText('我的收藏')).toBeInTheDocument();
    expect(screen.getByText('我的优惠券')).toBeInTheDocument();
    expect(screen.getByText('我的帖子')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('购买记录展示订单与状态', async () => {
    server.use(
      http.get(/\/api\/v1\/user\/orders$/, () =>
        HttpResponse.json(
          envelope({
            items: [
              {
                id: 1,
                orderNo: 'ZX202611100001',
                courseId: 1,
                courseName: 'TypeScript 系统入门',
                activityType: 'normal',
                activityId: null,
                originalCents: 19900,
                currentCents: 9900,
                discountCents: 2000,
                paidCents: 7900,
                couponClaimId: 9,
                status: 'paid',
                paidAt: '2026-11-10T02:00:00.000Z',
                createdAt: '2026-11-10T02:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    );

    renderWithProviders([{ path: '/user/orders', element: <OrdersPage /> }], '/user/orders');
    expect(await screen.findByText('ZX202611100001')).toBeInTheDocument();
    expect(screen.getByText('TypeScript 系统入门')).toBeInTheDocument();
    expect(screen.getByText('已支付')).toBeInTheDocument();
    expect(screen.getByText('¥79.00')).toBeInTheDocument();
  });
});
