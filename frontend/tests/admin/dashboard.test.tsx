import { screen } from '@testing-library/react';
import DashboardPage from '@/features/admin/dashboard/DashboardPage';
import { renderWithProviders } from '../utils/render';

describe('DashboardPage', () => {
  it('只渲染占位卡片与接口未开放说明，不显示虚构统计', async () => {
    renderWithProviders(
      [{ path: '/admin', element: <DashboardPage /> }],
      '/admin',
    );

    expect(
      await screen.findByRole('heading', { name: '工作台' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/统计接口尚未开放/),
    ).toBeInTheDocument();

    // 8 张占位卡片统一显示 —
    expect(screen.getAllByText('—')).toHaveLength(8);
    expect(screen.getByText('用户总数')).toBeInTheDocument();
    expect(screen.getByText('进行中秒杀')).toBeInTheDocument();
  });
});
