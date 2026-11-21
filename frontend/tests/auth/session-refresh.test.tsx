import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { queryClient } from '@/app/query-client';
import { SessionGate } from '@/app/session-gate';
import { UserHeader } from '@/components/layout/UserHeader';
import LoginPage from '@/features/auth/LoginPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';

// 统一响应包
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-refresh' };
}

// 带账户菜单的最小布局
function HeaderLayout() {
  return (
    <>
      <UserHeader />
      <Outlet />
    </>
  );
}

describe('login session refresh', () => {
  afterEach(() => {
    // 先卸载组件再清空登录态，避免已挂载组件在 act 外更新
    cleanup();
    useSessionStore.getState().clear();
    queryClient.clear();
  });

  it('登出后重新登录会回填昵称等完整资料', async () => {
    // /auth/me 首次返回旧用户，登录后返回完整的新用户
    let meCalls = 0;
    server.use(
      http.get(/\/api\/v1\/auth\/me$/, () => {
        meCalls += 1;
        const user =
          meCalls === 1
            ? { id: 1, email: 'old@example.com', nickname: '旧用户', role: 'user' }
            : { id: 2, email: 'new@example.com', nickname: '回填用户', role: 'user' };
        return HttpResponse.json(envelope(user));
      }),
      http.post(/\/api\/v1\/auth\/logout$/, () => HttpResponse.json(envelope(null))),
      // 登录响应仅含角色，与后端一致
      http.post(/\/api\/v1\/auth\/login$/, () => HttpResponse.json(envelope({ role: 'user' }))),
    );
    useSessionStore.setState({
      user: { id: 1, email: 'old@example.com', nickname: '旧用户', role: 'user' } as never,
    });

    const router = createMemoryRouter(
      [
        {
          element: <HeaderLayout />,
          children: [
            { path: '/', element: <div>home-page</div> },
            { path: '/user', element: <div>user-home</div> },
            { path: '/login', element: <LoginPage /> },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <SessionGate>
            <RouterProvider router={router} />
          </SessionGate>
        </QueryClientProvider>
      </AntdApp>,
    );

    // 登出：清空会话并回到首页
    await userEvent.click(await screen.findByRole('button', { name: /旧用户的账户菜单/ }));
    await userEvent.click(await screen.findByText('退出登录'));
    await userEvent.click(await screen.findByRole('button', { name: '登录' }));

    // 重新登录：后端登录响应缺少昵称，需由 /auth/me 回填
    await userEvent.type(await screen.findByLabelText('邮箱'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('密码'), 'abc12345');
    await userEvent.click(screen.getByRole('button', { name: '登 录' }));

    expect(await screen.findByRole('button', { name: /回填用户的账户菜单/ })).toBeInTheDocument();
  });
});
