import { Alert, App as AntdApp, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { login } from '@/api/auth';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { queryClient } from '@/app/query-client';
import { useSessionStore } from '@/stores/session';
import { validateEmail, validatePassword } from '@/lib/validators';

// 管理端登录表单：固定三字段
interface AdminLoginFormValues {
  email: string;
  password: string;
  totpCode: string;
}

// 管理端登录页
export default function AdminLoginPage() {
  const [form] = Form.useForm<AdminLoginFormValues>();
  const navigate = useNavigate();
  const setUser = useSessionStore((state) => state.setUser);
  const { message } = AntdApp.useApp();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 提交管理端登录：后端统一校验密码与动态码
  async function handleFinish(values: AdminLoginFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      const loggedIn = await login(values);
      queryClient.setQueryData(queryKeys.authMe, loggedIn);
      setUser(loggedIn);
      message.success('登录成功');
      navigate(loggedIn.role === 'admin' ? '/admin' : '/user', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: 32, background: '#fff', borderRadius: 6, boxShadow: 'var(--shadow-card)' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        管理端登录
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        管理员需填写邮箱、密码与动态验证码；缺码或错码统一提示「邮箱或密码错误」。
      </Typography.Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={handleFinish}>
        <Form.Item
          name="email"
          label="邮箱"
          rules={[
            { required: true, message: '请输入邮箱' },
            {
              validator: (_, value: string) => {
                const message = validateEmail(value ?? '');
                return message ? Promise.reject(new Error(message)) : Promise.resolve();
              },
            },
          ]}
        >
          <Input placeholder="admin@example.com" autoComplete="email" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={[
            { required: true, message: '请输入密码' },
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
        <Form.Item
          name="totpCode"
          label="动态验证码"
          rules={[
            { required: true, message: '请输入 6 位动态验证码' },
            { pattern: /^\d{6}$/, message: '请输入 6 位动态验证码' },
          ]}
        >
          <Input placeholder="6 位数字" maxLength={6} inputMode="numeric" autoComplete="one-time-code" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting} disabled={submitting}>
          登录管理端
        </Button>
      </Form>
    </div>
  );
}
