import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import GrouponListPage from '@/features/groupon/GrouponListPage';
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
