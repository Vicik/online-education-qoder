import { App as AntdApp, Button, Card, Form, Input, Select, Space } from 'antd';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { createCourse } from '@/api/admin/courses';
import type { CourseCreateInput, CourseWriteResult } from '@/api/types';
import { ImageUploader, type ImageValue } from '@/components/common/ImageUploader';
import { MoneyInput } from '@/components/common/MoneyInput';
import { PageHeader } from '@/components/common/PageHeader';
import { RichTextEditor } from '@/components/common/RichTextEditor';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { serializeRichHtmlForSave } from '@/lib/sanitize';

// 创建表单值：封面为 key + 预览 url，富文本为编辑器输出
interface CourseFormValues {
  name: string;
  type: 'video' | 'audio' | 'rich';
  originalCents: number | null;
  saleCents: number | null;
  instructor?: string;
  cover?: ImageValue | null;
  intro?: string;
  detailRich?: string;
}

// 课程类型选项
const TYPE_OPTIONS = [
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'rich', label: '图文' },
];

// 创建课程：保存草稿后进入工作区章节维护
export default function CourseCreatePage() {
  // 路由跳转
  const navigate = useNavigate();
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // Query 缓存：创建成功后刷新列表
  const queryClient = useQueryClient();
  // 表单实例
  const [form] = Form.useForm<CourseFormValues>();

  // 创建 Mutation：管理端创建类 POST 携带幂等键
  const createMutation = useIdempotentMutation<CourseWriteResult, CourseCreateInput>(
    (payload, key) => createCourse(payload, key),
    {
      onSuccess: async (created) => {
        await queryClient.invalidateQueries({ queryKey: ['admin', 'courses'] });
        message.success('课程已保存为草稿');
        navigate(`/admin/courses/${created.id}?step=chapters`);
      },
      onError: (error) => message.error(error.message),
    },
  );

  // 提交：把表单值转为接口载荷（封面只提交 key）
  async function submit(values: CourseFormValues) {
    // 接口载荷：富文本保存前回写图片 key
    const payload: CourseCreateInput = {
      name: values.name.trim(),
      type: values.type,
      originalCents: values.originalCents ?? 0,
      saleCents: values.saleCents ?? 0,
      instructor: values.instructor?.trim() || null,
      coverUrl: values.cover?.key ?? null,
      intro: values.intro?.trim() || null,
      detailRich: values.detailRich ? serializeRichHtmlForSave(values.detailRich) : null,
    };
    await createMutation.mutateAsync(payload);
  }

  // 校验通过后二次确认再提交
  function handleFinish(values: CourseFormValues) {
    modal.confirm({
      title: '保存课程',
      content: '将创建草稿课程并进入章节维护，确认保存？',
      okText: '保存',
      cancelText: '取消',
      // 两个汉字的按钮不自动插空格，保持文案可被精确匹配与展示
      okButtonProps: { autoInsertSpace: false },
      onOk: () => submit(values),
    });
  }

  return (
    <div>
      <PageHeader title="创建课程" />
      <Card>
        <Form<CourseFormValues>
          form={form}
          layout="vertical"
          initialValues={{ type: 'video' }}
          onFinish={handleFinish}
        >
          <Form.Item
            name="name"
            label="课程名称"
            rules={[
              { required: true, message: '请输入课程名称' },
              { max: 40, message: '最多 40 个字符' },
            ]}
          >
            <Input placeholder="最多 40 个字符" />
          </Form.Item>
          <Form.Item name="type" label="课程类型" rules={[{ required: true }]}>
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="originalCents"
            label="原价"
            rules={[{ required: true, message: '请输入原价' }]}
          >
            <MoneyInput placeholder="原价（元）" />
          </Form.Item>
          <Form.Item
            name="saleCents"
            label="售价"
            dependencies={['originalCents']}
            rules={[
              { required: true, message: '请输入售价' },
              ({ getFieldValue }) => ({
                validator(_, value: number | null) {
                  // 当前原价
                  const original = getFieldValue('originalCents') as number | null;
                  if (value === null || original === null || value <= original) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('售价不得高于原价'));
                },
              }),
            ]}
          >
            <MoneyInput placeholder="售价（元）" />
          </Form.Item>
          <Form.Item
            name="instructor"
            label="讲师"
            rules={[{ required: true, message: '请输入讲师' }]}
          >
            <Input placeholder="讲师姓名" />
          </Form.Item>
          <Form.Item
            name="cover"
            label="封面"
            rules={[{ required: true, message: '请上传封面' }]}
          >
            <ImageUploader />
          </Form.Item>
          <Form.Item name="intro" label="简介">
            <Input.TextArea rows={3} maxLength={200} />
          </Form.Item>
          <Form.Item name="detailRich" label="详细介绍">
            <RichTextEditor placeholder="支持标题、列表、图片与表格" />
          </Form.Item>
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={createMutation.isPending}
            >
              保存并维护章节
            </Button>
            <Button onClick={() => navigate('/admin/courses')}>取消</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
