import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp } from 'antd';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router';
import { routerFlushSync } from '@/app/flush-sync';

// 页面级测试包装：独立 QueryClient（关闭重试）+ 内存路由 + AntD App 上下文
export function renderWithProviders(routes: RouteObject[], initialEntry: string) {
  // 每个用例独立缓存，避免相互污染
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  // 内存路由：断言跳转用 router.state.location
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] });

  render(
    <AntdApp>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} flushSync={routerFlushSync} />
      </QueryClientProvider>
    </AntdApp>,
  );

  return { queryClient, router };
}
