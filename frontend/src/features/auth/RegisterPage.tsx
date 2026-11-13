import { Alert, App as AntdApp, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { register } from '@/api/auth';
import { ApiError } from '@/api/errors';
import {
  validateConfirmPassword,
  validateEmail,
  validateNickname,
  validatePassword,
} from '@/lib/validators';

// 注册表单
interface RegisterFormValues {
  email: string;
  password: string;
  confirmPassword: string;
  nickname: string;
}

// 注册页
export default function RegisterPage() {
  const [form] = Form.useForm<RegisterFormValues>();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 提交注册：成功后不自动登录
  async function handleFinish(values: RegisterFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await register(values);
      message.success('注册成功，请登录');
      navigate('/login?registered=1', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && (caught.code === 1001 || caught.code === 409)) {
        form.setFields([{ name: 'email', errors: [caught.message] }]);
      } else {
        setError(caught instanceof ApiError ? caught.message : '注册失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: 32, background: '#fff', borderRadius: 6, boxShadow: 'var(--shadow-card)' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        注册
      </Typography.Title>
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
          <Input placeholder="new@example.com" autoComplete="email" />
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
          <Input.Password placeholder="8–64 位，至少一个字母和一个数字" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认密码"
          dependencies={['password']}
          rules={[
            { required: true, whitespace: true, message: '请再次输入密码' },
            ({ getFieldValue }) => ({
              validator: (_, value: string) => {
                const message = validateConfirmPassword(getFieldValue('password') ?? '', value ?? '');
                return message ? Promise.reject(new Error(message)) : Promise.resolve();
              },
            }),
          ]}
        >
          <Input.Password placeholder="请再次输入密码" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="nickname"
          label="昵称"
          rules={[
            { required: true, whitespace: true, message: '请输入昵称' },
            {
              validator: (_, value: string) => {
                const message = validateNickname(value ?? '');
                return message ? Promise.reject(new Error(message)) : Promise.resolve();
              },
            },
          ]}
        >
          <Input placeholder="最多 30 个字符" maxLength={30} showCount />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting} disabled={submitting}>
          注册
        </Button>
      </Form>
      <div style={{ marginTop: 16, textAlign: 'center' }}>
        已有账号？<Link to="/login">去登录</Link>
      </div>
    </div>
  );
}
