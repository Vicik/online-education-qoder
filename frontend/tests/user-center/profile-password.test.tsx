import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { routerFlushSync } from '@/app/flush-sync';
import { queryClient } from '@/app/query-client';
import { createAppRoutes } from '@/app/router';
import ProfilePage from '@/features/user-center/ProfilePage';
import PasswordPage from '@/features/user-center/PasswordPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-me' };
}

describe('profile and password', () => {
  beforeEach(() => {
    useSessionStore.getState().setUser({
      id: 2,
      email: 'user@example.com',
      nickname: '学员',
      avatarKey: null,
      avatarUrl: null,
      gender: 'secret',
      role: 'user',
      createdAt: '2026-11-01T00:00:00.000Z',
    } as never);
  });

  afterEach(() => {
    // 先卸载组件再清空登录态，避免已挂载组件在 act 外更新
    cleanup();
    useSessionStore.getState().clear();
  });

  it('资料页邮箱只读，保存后更新会话昵称', async () => {
    let saved: { nickname?: string } = {};
    server.use(
      http.get(/\/api\/v1\/user\/profile$/, () =>
        HttpResponse.json(
          envelope({
            id: 2,
            email: 'user@example.com',
            nickname: '学员',
            avatarKey: null,
            avatarUrl: null,
            gender: 'secret',
          }),
        ),
      ),
      http.put(/\/api\/v1\/user\/profile$/, async ({ request }) => {
        saved = (await request.json()) as { nickname?: string };
        return HttpResponse.json(envelope(null));
      }),
    );

    renderWithProviders([{ path: '/user/profile', element: <ProfilePage /> }], '/user/profile');

    const email = await screen.findByLabelText('邮箱');
    expect(email).toBeDisabled();

    const nickname = screen.getByLabelText('昵称');
    await userEvent.clear(nickname);
    await userEvent.type(nickname, '新昵称');
    await userEvent.click(screen.getByRole('button', { name: /保\s*存/ }));

    await screen.findByText('保存成功');
    expect(saved.nickname).toBe('新昵称');
    expect(useSessionStore.getState().user?.nickname).toBe('新昵称');
  });

  it('改密成功清会话并跳登录', async () => {
    server.use(
      http.post(/\/api\/v1\/auth\/password$/, () => HttpResponse.json(envelope(null))),
    );

    const { router } = renderWithProviders(
      [
        { path: '/user/password', element: <PasswordPage /> },
        { path: '/login', element: <div>login-page</div> },
      ],
      '/user/password',
    );

    await userEvent.type(screen.getByLabelText('当前密码'), 'abc12345');
    await userEvent.type(screen.getByLabelText('新密码'), 'NewPassw0rd2');
    await userEvent.type(screen.getByLabelText('确认新密码'), 'NewPassw0rd2');
    await userEvent.click(screen.getByRole('button', { name: '修改密码' }));

    await screen.findByText('login-page');
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?changed=1');
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('真实路由下改密后仍落在带 changed=1 的登录页', async () => {
    server.use(
      http.post(/\/api\/v1\/auth\/password$/, () => HttpResponse.json(envelope(null))),
    );

    const router = createMemoryRouter(createAppRoutes(), { initialEntries: ['/user/password'] });
    render(
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} flushSync={routerFlushSync} />
        </QueryClientProvider>
      </AntdApp>,
    );

    const user = userEvent.setup({ delay: null });
    await user.type(await screen.findByLabelText('当前密码'), 'abc12345');
    await user.type(screen.getByLabelText('新密码'), 'NewPassw0rd2');
    await user.type(screen.getByLabelText('确认新密码'), 'NewPassw0rd2');
    await user.click(screen.getByRole('button', { name: '修改密码' }));

    // 守卫不能在跳转后把 changed=1 覆盖成 redirect
    expect(await screen.findByText('密码已修改，请重新登录', { selector: '.ant-alert-message' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?changed=1');
    expect(useSessionStore.getState().user).toBeNull();
  }, 40_000);
});
