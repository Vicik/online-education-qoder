import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import HomePage from '@/features/home/HomePage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-home' };
}

// 课程工厂：卡片只消费这些字段
function course(id: number, name: string) {
  return {
    id,
    name,
    type: 'video',
    coverKey: null,
    coverUrl: null,
    instructor: '张老师',
    originalCents: 19900,
    saleCents: 9900,
    status: 'published',
  };
}

describe('HomePage', () => {
  it('渲染推荐与最新两个区块，卡片不展示类型与报名人数', async () => {
    server.use(
      http.get(/\/api\/v1\/home\/recommendations$/, () =>
        HttpResponse.json(envelope({ courses: [course(1, '推荐课程')] })),
      ),
      http.get(/\/api\/v1\/courses$/, () =>
        HttpResponse.json(
          envelope({ items: [course(2, '最新课程')], total: 1, page: 1, pageSize: 8 }),
        ),
      ),
    );

    renderWithProviders([{ path: '/', element: <HomePage /> }], '/');

    expect(await screen.findByRole('link', { name: '推荐课程' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: '最新课程' })).toBeInTheDocument();
    expect(screen.getAllByText('¥99.00')).toHaveLength(2);
    expect(screen.queryByText('视频')).not.toBeInTheDocument();
    expect(screen.queryByText(/报名/)).not.toBeInTheDocument();
  });

  it('推荐为空时整块隐藏，不影响最新区块', async () => {
    server.use(
      http.get(/\/api\/v1\/home\/recommendations$/, () =>
        HttpResponse.json(envelope({ courses: [] })),
      ),
      http.get(/\/api\/v1\/courses$/, () =>
        HttpResponse.json(
          envelope({ items: [course(2, '最新课程')], total: 1, page: 1, pageSize: 8 }),
        ),
      ),
    );

    renderWithProviders([{ path: '/', element: <HomePage /> }], '/');

    expect(await screen.findByRole('link', { name: '最新课程' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '推荐课程' })).not.toBeInTheDocument();
    expect(screen.queryByText('暂无推荐课程')).not.toBeInTheDocument();
  });
});
