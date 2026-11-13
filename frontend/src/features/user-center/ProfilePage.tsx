import { App as AntdApp, Button, Card, Form, Input, Radio } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getProfile, updateProfile } from '@/api/user';
import { queryKeys } from '@/api/query-keys';
import { ImageUploader, type ImageValue } from '@/components/common/ImageUploader';
import { PageHeader } from '@/components/common/PageHeader';
import { useSessionStore } from '@/stores/session';

// 资料表单值
interface ProfileFormValues {
  email: string;
  nickname: string;
  gender: 'male' | 'female' | 'secret';
  avatar: ImageValue | null;
}

// 修改资料：邮箱只读；头像只提交 key
export default function ProfilePage() {
  // 表单实例
  const [form] = Form.useForm<ProfileFormValues>();
  // 会话用户
  const user = useSessionStore((state) => state.user);
  // 设置会话用户
  const setUser = useSessionStore((state) => state.setUser);
  // QueryClient
  const queryClient = useQueryClient();
  // AntD message
  const { message } = AntdApp.useApp();

  // 当前资料
  const query = useQuery({ queryKey: queryKeys.profile, queryFn: getProfile });

  // 保存
  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.authMe });
      await queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      message.success('保存成功');
    },
  });

  // 资料加载后回填表单
  useEffect(() => {
    if (!query.data) return;
    form.setFieldsValue({
      email: query.data.email ?? '',
      nickname: query.data.nickname ?? '',
      gender: query.data.gender ?? 'secret',
      avatar: query.data.avatarKey
        ? { key: query.data.avatarKey, url: query.data.avatarUrl }
        : null,
    });
  }, [query.data, form]);

  // 提交：头像写回 key，昵称同步会话
  async function handleFinish(values: ProfileFormValues): Promise<void> {
    await mutation.mutateAsync({
      nickname: values.nickname,
      avatarUrl: values.avatar?.key ?? null,
      gender: values.gender,
    });
    if (user) {
      setUser({
        ...user,
        nickname: values.nickname,
        avatarKey: values.avatar?.key ?? null,
        avatarUrl: values.avatar?.url ?? null,
      });
    }
  }

  if (query.isLoading) return <Card loading />;

  return (
    <div>
      <PageHeader title="修改资料" />
      <Card style={{ maxWidth: 640 }}>
        <Form form={form} layout="vertical" onFinish={handleFinish}>
          <Form.Item name="email" label="邮箱">
            <Input disabled />
          </Form.Item>
          <Form.Item name="avatar" label="头像">
            <ImageUploader />
          </Form.Item>
          <Form.Item
            name="nickname"
            label="昵称"
            rules={[
              { required: true, whitespace: true, message: '请输入昵称' },
              { max: 30, message: '昵称最多 30 个字符' },
            ]}
          >
            <Input maxLength={30} showCount />
          </Form.Item>
          <Form.Item name="gender" label="性别">
            <Radio.Group
              options={[
                { label: '男', value: 'male' },
                { label: '女', value: 'female' },
                { label: '保密', value: 'secret' },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            保存
          </Button>
        </Form>
      </Card>
    </div>
  );
}
