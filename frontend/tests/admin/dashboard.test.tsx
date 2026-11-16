import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import DashboardPage from '@/features/admin/dashboard/DashboardPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-dashboard' };
}

// 统计样例：八项齐全，收入以分存储
const STATS = {
  userCount: 11,
  courseCount: 22,
  publishedCourseCount: 33,
  orderCount: 44,
  paidOrderCount: 55,
  revenueCents: 12345,
  ongoingGrouponCount: 66,
  ongoingFlashSaleCount: 77,
};

describe('DashboardPage', () => {
  it('展示接口返回的八项统计，收入分转元', async () => {
    server.use(
      http.get(/\/api\/v1\/admin\/dashboard\/stats$/, () =>
        HttpResponse.json(envelope(STATS)),
      ),
    );

    renderWithProviders(
      [{ path: '/admin', element: <DashboardPage /> }],
      '/admin',
    );

    expect(
      await screen.findByRole('heading', { name: '工作台' }),
    ).toBeInTheDocument();

    // 八张卡片标题
    for (const title of [
      '用户总数',
      '课程总数',
      '已发布课程',
      '订单总数',
      '已支付订单',
      '收入（元）',
      '进行中拼团',
      '进行中秒杀',
    ]) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }

    // 非收入项按整数展示
    for (const value of ['11', '22', '33', '44', '55', '66', '77']) {
      expect(await screen.findByText(value)).toBeInTheDocument();
    }
    // 收入由分转元并保留两位小数（antd 将数值拆分为整数与小数两段）
    expect(
      (await screen.findByText('收入（元）')).closest('.ant-statistic'),
    ).toHaveTextContent('123.45');
    expect(screen.getByText('¥')).toBeInTheDocument();
    // 加载完成后不再出现占位符
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('加载失败展示提示，点击重试后恢复', async () => {
    // 请求次数：首次失败、重试成功
    let requestCount = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/dashboard\/stats$/, () => {
        requestCount += 1;
        return requestCount === 1
          ? HttpResponse.json(
              { code: 5000, message: '服务端错误', requestId: 'r-dashboard' },
              { status: 500 },
            )
          : HttpResponse.json(envelope(STATS));
      }),
    );

    renderWithProviders(
      [{ path: '/admin', element: <DashboardPage /> }],
      '/admin',
    );

    expect(
      await screen.findByText('工作台统计加载失败'),
    ).toBeInTheDocument();
    expect(screen.getByText(/服务端错误/)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /重\s*试/ }),
    );

    expect(await screen.findByText('11')).toBeInTheDocument();
    expect(
      screen.getByText('收入（元）').closest('.ant-statistic'),
    ).toHaveTextContent('123.45');
    await waitFor(() => expect(requestCount).toBe(2));
    expect(screen.queryByText('工作台统计加载失败')).not.toBeInTheDocument();
  });
});
