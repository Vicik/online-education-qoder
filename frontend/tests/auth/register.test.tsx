import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { RouterProvider, createMemoryRouter } from 'react-router';
import LoginPage from '@/features/auth/LoginPage';
import RegisterPage from '@/features/auth/RegisterPage';
import { server } from '../msw/server';

// 渲染注册页与登录页探针
function renderRegister() {
  const router = createMemoryRouter(
    [
      { path: '/register', element: <RegisterPage /> },
      { path: '/login', element: <LoginPage /> },
    ],
    { initialEntries: ['/register'] },
  );
  render(
    <AntdApp>
      <RouterProvider router={router} />
    </AntdApp>,
  );
}

// 填完注册表单
async function fillRegisterForm() {
  await userEvent.type(screen.getByLabelText('邮箱'), 'new@example.com');
  await userEvent.type(screen.getByLabelText('密码'), 'abc12345');
  await userEvent.type(screen.getByLabelText('确认密码'), 'abc12345');
  await userEvent.type(screen.getByLabelText('昵称'), '新学员');
}

describe('RegisterPage', () => {
  it('两次密码不一致时阻止提交', async () => {
    renderRegister();
    await userEvent.type(screen.getByLabelText('邮箱'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('密码'), 'abc12345');
    await userEvent.type(screen.getByLabelText('确认密码'), 'abc12346');
    await userEvent.type(screen.getByLabelText('昵称'), '新学员');
    await userEvent.click(screen.getByRole('button', { name: /注\s*册/ }));
    expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
  });

  it('注册成功不自动登录，跳登录页并提示', async () => {
    server.use(
      http.post(/\/api\/v1\/auth\/register$/, () =>
        HttpResponse.json({ code: 0, message: 'ok', data: null, requestId: 'r-reg' }, { status: 201 }),
      ),
    );
    renderRegister();
    await fillRegisterForm();
    await userEvent.click(screen.getByRole('button', { name: /注\s*册/ }));
    expect(await screen.findByText('注册成功，请登录')).toBeInTheDocument();
  });

  it('邮箱重复由后端 1001 内联提示', async () => {
    server.use(
      http.post(/\/api\/v1\/auth\/register$/, () =>
        HttpResponse.json(
          { code: 1001, message: '邮箱已被注册', data: null, requestId: 'r-dup' },
          { status: 409 },
        ),
      ),
    );
    renderRegister();
    await fillRegisterForm();
    await userEvent.click(screen.getByRole('button', { name: /注\s*册/ }));
    expect(await screen.findByText('邮箱已被注册')).toBeInTheDocument();
  });
});
