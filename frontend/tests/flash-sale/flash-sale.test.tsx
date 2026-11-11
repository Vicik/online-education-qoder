import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import FlashSaleListPage from '@/features/flash-sale/FlashSaleListPage';
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
  it('展示秒杀价、剩余库存与倒计时', async () => {
    server.use(
      http.get(/\/api\/v1\/flash-sales$/, () =>
        HttpResponse.json(envelope({ items: [sale], total: 1, page: 1, pageSize: 12 })),
      ),
    );

    renderWithProviders([{ path: '/flash-sales', element: <FlashSaleListPage /> }], '/flash-sales');

    expect(await screen.findByRole('link', { name: '限时秒杀' })).toBeInTheDocument();
    expect(screen.getByText('¥49.00')).toBeInTheDocument();
    expect(screen.getByText(/剩余 2 件/)).toBeInTheDocument();
    expect(screen.getByText(/距结束/)).toBeInTheDocument();
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
