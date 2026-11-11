import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { createAppRoutes } from '@/app/router';
import { useSessionStore, type SessionUser } from '@/stores/session';
import { server } from '../msw/server';

// 在指定地址与角色下渲染应用路由
function renderAt(path: string, user: SessionUser | null) {
  useSessionStore.setState({ user });
  const router = createMemoryRouter(createAppRoutes(), { initialEntries: [path] });
  // 真实页面依赖 QueryClient，测试关闭重试
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('router guards', () => {
  afterEach(() => useSessionStore.setState({ user: null }));

  it('游客访问结算页跳到登录页', async () => {
    renderAt('/checkout/1', null);
    expect(
      await screen.findByRole('heading', { name: '登录' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('管理员访问用户端跳管理端工作台', async () => {
    renderAt('/courses', { role: 'admin' } as SessionUser);
    expect(await screen.findByText('工作台（建设中）')).toBeInTheDocument();
  });

  it('普通用户访问管理端跳 403', async () => {
    renderAt('/admin', { role: 'user' } as SessionUser);
    expect(await screen.findByText('无权访问')).toBeInTheDocument();
  });

  it('管理员可进入管理端子路由', async () => {
    renderAt('/admin/courses/create', { role: 'admin' } as SessionUser);
    expect(
      await screen.findByRole('heading', { name: '创建课程' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('普通用户进入用户中心渲染侧栏布局', async () => {
    server.use(
      http.get(/\/api\/v1\/user\/overview$/, () =>
        HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { enrolledCount: 0, completedCount: 0, favoriteCount: 0, couponCount: 0, postCount: 0 },
          requestId: 'r-router',
        }),
      ),
    );
    renderAt('/user', { role: 'user' } as SessionUser);
    expect(await screen.findByRole('heading', { name: '学习概览' })).toBeInTheDocument();
    expect(screen.getByText('我的帖子')).toBeInTheDocument();
  });
});
