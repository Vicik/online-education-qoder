import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { RouterProvider, createMemoryRouter } from 'react-router';
import AdminLoginPage from '@/features/auth/AdminLoginPage';
import { server } from '../msw/server';

// 渲染管理端登录页
function renderAdminLogin() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/admin/login', element: <AdminLoginPage /> },
      { path: '/admin', element: <div>admin-home</div> },
      { path: '/user', element: <div>user-home</div> },
    ],
    { initialEntries: ['/admin/login'] },
  );
  render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AntdApp>,
  );
}

// 管理端登录成功桩
function mockAdminLogin(role: 'user' | 'admin') {
  server.use(
    http.post(/\/api\/v1\/auth\/login$/, () =>
      HttpResponse.json({
        code: 0,
        message: 'ok',
        data: { id: 1, email: 'admin@example.com', nickname: '管理员', role },
        requestId: 'r-admin',
      }),
    ),
  );
}

describe('AdminLoginPage', () => {
  it('缺少动态码时不提交', async () => {
    renderAdminLogin();
    await userEvent.type(screen.getByLabelText('邮箱'), 'admin@example.com');
    await userEvent.type(screen.getByLabelText('密码'), 'abc12345');
    await userEvent.click(screen.getByRole('button', { name: '登录管理端' }));
    expect(await screen.findByText('请输入 6 位动态验证码')).toBeInTheDocument();
  });

  it('管理员登录后进入 /admin', async () => {
    mockAdminLogin('admin');
    renderAdminLogin();
    await userEvent.type(screen.getByLabelText('邮箱'), 'admin@example.com');
    await userEvent.type(screen.getByLabelText('密码'), 'abc12345');
    await userEvent.type(screen.getByLabelText('动态验证码'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '登录管理端' }));
    expect(await screen.findByText('admin-home')).toBeInTheDocument();
  });

  it('普通用户从管理端登录仍进入用户端', async () => {
    mockAdminLogin('user');
    renderAdminLogin();
    await userEvent.type(screen.getByLabelText('邮箱'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('密码'), 'abc12345');
    await userEvent.type(screen.getByLabelText('动态验证码'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '登录管理端' }));
    expect(await screen.findByText('user-home')).toBeInTheDocument();
  });
});
