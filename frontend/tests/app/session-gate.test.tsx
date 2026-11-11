import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { PropsWithChildren } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { createAppRoutes } from '@/app/router';
import { SessionGate } from '@/app/session-gate';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';

// 测试包装：独立 QueryClient
function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('SessionGate', () => {
  it('401 时按游客渲染子节点', async () => {
    server.use(
      http.get(/\/api\/v1\/auth\/me$/, () =>
        HttpResponse.json(
          { code: 2001, message: '未登录', data: null, requestId: 'r' },
          { status: 401 },
        ),
      ),
    );
    render(
      <SessionGate>
        <div>guest-content</div>
      </SessionGate>,
      { wrapper },
    );
    expect(await screen.findByText('guest-content')).toBeInTheDocument();
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('200 时写入会话 Store', async () => {
    server.use(
      http.get(/\/api\/v1\/auth\/me$/, () =>
        HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { id: 1, email: 'u@example.com', nickname: '学员', role: 'user' },
          requestId: 'r2',
        }),
      ),
    );
    render(
      <SessionGate>
        <div>user-content</div>
      </SessionGate>,
      { wrapper },
    );
    expect(await screen.findByText('user-content')).toBeInTheDocument();
    expect(useSessionStore.getState().user?.role).toBe('user');
  });

  it('受保护路由整页加载时会话落地前不触发守卫跳登录', async () => {
    // 模拟刷新受保护页：Store 初始为空，仅 /auth/me 能证明已登录
    useSessionStore.setState({ user: null });
    server.use(
      http.get(/\/api\/v1\/auth\/me$/, () =>
        HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { id: 1, email: 'u@example.com', nickname: '学员', role: 'user' },
          requestId: 'r3',
        }),
      ),
      http.get(/\/api\/v1\/user\/overview$/, () =>
        HttpResponse.json({
          code: 0,
          message: 'ok',
          data: {
            enrolledCount: 0,
            completedCount: 0,
            favoriteCount: 0,
            couponCount: 0,
            postCount: 0,
          },
          requestId: 'r4',
        }),
      ),
    );
    // 独立缓存与内存路由，复现应用根部的引导顺序
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(createAppRoutes(), { initialEntries: ['/user'] });
    render(
      <QueryClientProvider client={client}>
        <SessionGate>
          <RouterProvider router={router} />
        </SessionGate>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: '学习概览' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/user');
  });
});
