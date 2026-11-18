import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// 宣传课程工厂：banner 需要封面地址
function bannerCourse(id: number, name: string) {
  return { ...course(id, name), coverUrl: `https://cdn/banner-${id}.png` };
}

// 宣传位接口桩：返回指定课程列表
function mockBanners(items: ReturnType<typeof bannerCourse>[]) {
  server.use(
    http.get(/\/api\/v1\/home\/banners$/, () =>
      HttpResponse.json(envelope({ courses: items })),
    ),
  );
}

describe('HomePage', () => {
  it('渲染推荐与最新两个区块，卡片不展示类型与报名人数', async () => {
    mockBanners([]);
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
    mockBanners([]);
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

  it('宣传课程以 banner 展示封面并排在推荐之前，点击跳详情', async () => {
    mockBanners([bannerCourse(11, '宣传课一'), bannerCourse(12, '宣传课二')]);
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

    renderWithProviders(
      [
        { path: '/', element: <HomePage /> },
        { path: '/courses/:id', element: <div>课程详情</div> },
      ],
      '/',
    );

    const region = await screen.findByRole('region', { name: '首页宣传' });
    // slick 给非当前 slide 打 aria-hidden 且在无限轮播下克隆 slide，因此比对去重后的封面地址
    const srcs = within(region)
      .getAllByRole('img', { hidden: true })
      .map((node) => node.getAttribute('src'));
    expect(new Set(srcs)).toEqual(
      new Set(['https://cdn/banner-11.png', 'https://cdn/banner-12.png']),
    );

    // banner 区块位于推荐区块之前
    expect(
      region.compareDocumentPosition(
        screen.getByRole('heading', { name: '推荐课程' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.click(within(region).getByRole('link', { name: '宣传课一' }));
    expect(await screen.findByText('课程详情')).toBeInTheDocument();
  });

  it('无宣传课程时 banner 整块隐藏', async () => {
    mockBanners([]);
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
    expect(screen.queryByRole('region', { name: '首页宣传' })).not.toBeInTheDocument();
  });
});
