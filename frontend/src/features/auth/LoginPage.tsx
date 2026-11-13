import { Alert, App as AntdApp, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { login } from '@/api/auth';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { queryClient } from '@/app/query-client';
import { useSessionStore } from '@/stores/session';
import { validateEmail, validatePassword } from '@/lib/validators';

// 登录表单
interface LoginFormValues {
  email: string;
  password: string;
}

// 登录后的落地地址：管理员固定 /admin；普通用户仅接受站内 redirect
export function resolvePostLoginPath(
  user: { role: 'user' | 'admin' },
  redirect: string | null,
): string {
  if (user.role === 'admin') return '/admin';
  if (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) return redirect;
  return '/user';
}

// 登录页
export default function LoginPage() {
  const [form] = Form.useForm<LoginFormValues>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setUser = useSessionStore((state) => state.setUser);
  const { message } = AntdApp.useApp();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const registered = searchParams.get('registered') === '1';
  const passwordChanged = searchParams.get('changed') === '1';

  // 提交登录：成功写入会话并跳转
  async function handleFinish(values: LoginFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      const loggedIn = await login(values);
      queryClient.setQueryData(queryKeys.authMe, loggedIn);
      setUser(loggedIn);
      // 登录响应仅含角色，刷新会话以取回头像与昵称
      void queryClient.invalidateQueries({ queryKey: queryKeys.authMe });
      message.success('登录成功');
      navigate(resolvePostLoginPath({ role: loggedIn.role ?? 'user' }, searchParams.get('redirect')), {
        replace: true,
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: 32, background: '#fff', borderRadius: 6, boxShadow: 'var(--shadow-card)' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        登录
      </Typography.Title>
      {registered && <Alert type="success" showIcon message="注册成功，请登录" style={{ marginBottom: 16 }} />}
      {passwordChanged && <Alert type="success" showIcon message="密码已修改，请重新登录" style={{ marginBottom: 16 }} />}
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={handleFinish}>
        <Form.Item
          name="email"
          label="邮箱"
          rules={[
            { required: true, whitespace: true, message: '请输入邮箱' },
            {
              validator: (_, value: string) => {
                const message = validateEmail(value ?? '');
                return message ? Promise.reject(new Error(message)) : Promise.resolve();
              },
            },
          ]}
        >
          <Input placeholder="user@example.com" autoComplete="email" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={[
            { required: true, whitespace: true, message: '请输入密码' },
            {
              validator: (_, value: string) => {
                const message = validatePassword(value ?? '');
                return message ? Promise.reject(new Error(message)) : Promise.resolve();
              },
            },
          ]}
        >
          <Input.Password placeholder="请输入密码" autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting} disabled={submitting}>
          登录
        </Button>
      </Form>
      <div style={{ marginTop: 16, textAlign: 'center' }}>
        还没有账号？<Link to="/register">注册</Link>
      </div>
    </div>
  );
}
