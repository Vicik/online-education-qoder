import { Alert, App as AntdApp, Button, Card, Form, Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { changePassword } from '@/api/auth';
import { clearSessionQueries } from '@/app/query-client';
import { validatePassword } from '@/lib/validators';
import { useSessionStore } from '@/stores/session';
import { PageHeader } from '@/components/common/PageHeader';

// 改密表单值
interface PasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

// 修改密码：成功后后端吊销会话，前端清空状态并回登录页
export default function PasswordPage() {
  // 表单实例
  const [form] = Form.useForm<PasswordFormValues>();
  // 跳转
  const navigate = useNavigate();
  // QueryClient
  const queryClient = useQueryClient();
  // 清空会话
  const clearSession = useSessionStore((state) => state.clear);
  // AntD message
  const { message } = AntdApp.useApp();
  // 业务错误
  const [error, setError] = useState<string | null>(null);

  // 改密请求
  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: async () => {
      // 同步提交到公开登录页再清会话：在受保护路由上清会话会触发守卫用 redirect 覆盖 changed=1
      await navigate('/login?changed=1', { replace: true, flushSync: true });
      clearSession();
      clearSessionQueries(queryClient);
      message.success('密码已修改，请重新登录');
    },
    onError: (caught: Error) => {
      setError(caught.message);
    },
  });

  return (
    <div>
      <PageHeader title="修改密码" />
      <Card style={{ maxWidth: 520 }}>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        <Form
          form={form}
          layout="vertical"
          onFinish={(values: PasswordFormValues) => mutation.mutate(values)}
        >
          <Form.Item
            name="currentPassword"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              {
                validator: (_, value: string) => {
                  // 复用统一密码规则
                  const validationMessage = validatePassword(value ?? '');
                  return validationMessage
                    ? Promise.reject(new Error(validationMessage))
                    : Promise.resolve();
                },
              },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator: (_, value: string) =>
                  getFieldValue('newPassword') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一致')),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            修改密码
          </Button>
        </Form>
      </Card>
    </div>
  );
}
