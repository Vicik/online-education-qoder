import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { RouterProvider, createMemoryRouter } from 'react-router';
import LoginPage, { resolvePostLoginPath } from '@/features/auth/LoginPage';
import { server } from '../msw/server';

// 测试路由：登录页与落地页探针
function renderLogin(initialEntry = '/login') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/user', element: <div>user-home</div> },
      { path: '/admin', element: <div>admin-home</div> },
      { path: '/courses/:id', element: <div>course-detail</div> },
    ],
    { initialEntries: [initialEntry] },
  );
  render(
    <AntdApp>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AntdApp>,
  );
}

// 登录接口成功桩
function mockLoginSuccess(role: 'user' | 'admin' = 'user') {
  server.use(
    http.post(/\/api\/v1\/auth\/login$/, () =>
      HttpResponse.json({
        code: 0,
        message: 'ok',
        data: { id: 2, email: 'user@example.com', nickname: '学员', role },
        requestId: 'r-login',
      }),
    ),
  );
}

describe('LoginPage', () => {
  it('普通用户登录后回 redirect 指定页', async () => {
    mockLoginSuccess('user');
    renderLogin('/login?redirect=%2Fcourses%2F1');
    await userEvent.type(screen.getByLabelText('邮箱'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('密码'), 'abc12345');
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    expect(await screen.findByText('course-detail')).toBeInTheDocument();
  });

  it('2003 统一提示邮箱或密码错误', async () => {
    server.use(
      http.post(/\/api\/v1\/auth\/login$/, () =>
        HttpResponse.json(
          { code: 2003, message: '邮箱或密码错误', data: null, requestId: 'r-bad' },
          { status: 422 },
        ),
      ),
    );
    renderLogin();
    await userEvent.type(screen.getByLabelText('邮箱'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('密码'), 'wrong123');
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    expect(await screen.findByText('邮箱或密码错误')).toBeInTheDocument();
  });

  it('外链 redirect 不允许，回退 /user', async () => {
    mockLoginSuccess('user');
    renderLogin('/login?redirect=https%3A%2F%2Fevil.example.com');
    await userEvent.type(screen.getByLabelText('邮箱'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('密码'), 'abc12345');
    await userEvent.click(screen.getByRole('button', { name: /登\s*录/ }));
    expect(await screen.findByText('user-home')).toBeInTheDocument();
  });
});

describe('resolvePostLoginPath', () => {
  it('管理员始终回 /admin', () => {
    expect(resolvePostLoginPath({ role: 'admin' }, '/courses/1')).toBe('/admin');
  });

  it('普通用户无 redirect 时回 /user，有站内 redirect 则优先', () => {
    expect(resolvePostLoginPath({ role: 'user' }, null)).toBe('/user');
    expect(resolvePostLoginPath({ role: 'user' }, '/courses/1')).toBe('/courses/1');
  });

  it('拒绝外链与协议相对地址', () => {
    expect(resolvePostLoginPath({ role: 'user' }, 'https://evil.example.com')).toBe('/user');
    expect(resolvePostLoginPath({ role: 'user' }, '//evil.example.com')).toBe('/user');
  });
});
