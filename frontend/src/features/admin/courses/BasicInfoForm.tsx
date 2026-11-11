import { App as AntdApp, Alert, Button, Form, Input, Select, Space } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { updateCourse } from '@/api/admin/courses';
import type { ApiError } from '@/api/errors';
import type {
  AdminCourseDetail,
  CourseUpdateInput,
  CourseWriteResult,
} from '@/api/types';
import { ImageUploader, type ImageValue } from '@/components/common/ImageUploader';
import { MoneyInput } from '@/components/common/MoneyInput';
import { RichTextEditor } from '@/components/common/RichTextEditor';
import { serializeRichHtmlForSave } from '@/lib/sanitize';

// 基本信息表单值
interface BasicFormValues {
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

// 封面回显：优先 coverKey；历史 http 地址原样作为回写值
function toCoverValue(course: AdminCourseDetail): ImageValue | null {
  // 回写值：key 或历史 http 地址
  const key = course.coverKey ?? course.coverUrl;
  return key ? { key, url: course.coverUrl } : null;
}

// 状态矩阵：与后端 EDITABLE_FIELDS 一致
function editableFields(course: AdminCourseDetail) {
  // 草稿可改全部基本信息
  const draft = course.status === 'draft';
  // 已发布全部基本信息只读
  const published = course.status === 'published';
  return {
    name: draft,
    type: draft && (course.chapters ?? []).length === 0,
    originalCents: draft,
    saleCents: draft,
    instructor: !published,
    cover: !published,
    intro: !published,
    detailRich: !published,
  };
}

// 生成编辑载荷：只发送当前状态允许修改的字段，version 必带
function toUpdatePayload(
  course: AdminCourseDetail,
  values: BasicFormValues,
): CourseUpdateInput {
  // 当前状态可编辑字段
  const fields = editableFields(course);
  // 请求载荷
  const payload: CourseUpdateInput = { version: course.version ?? 0 };
  if (fields.name) payload.name = values.name.trim();
  if (fields.type) payload.type = values.type;
  if (fields.originalCents) payload.originalCents = values.originalCents ?? 0;
  if (fields.saleCents) payload.saleCents = values.saleCents ?? 0;
  if (fields.instructor) payload.instructor = values.instructor?.trim() || null;
  if (fields.cover) payload.coverUrl = values.cover?.key ?? null;
  if (fields.intro) payload.intro = values.intro?.trim() || null;
  if (fields.detailRich) {
    payload.detailRich = values.detailRich
      ? serializeRichHtmlForSave(values.detailRich)
      : null;
  }
  return payload;
}

// 基本信息表单：按状态矩阵禁用，保存后由父级重取详情
export function BasicInfoForm(props: {
  course: AdminCourseDetail;
  onSaved: () => Promise<void>;
  onConflict: () => void;
}) {
  // 当前课程详情
  const { course } = props;
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 表单实例
  const [form] = Form.useForm<BasicFormValues>();
  // 当前可编辑字段
  const fields = editableFields(course);

  // 编辑 Mutation：PUT 带 version
  const mutation = useMutation<CourseWriteResult, ApiError, CourseUpdateInput>({
    mutationFn: (payload) => updateCourse(course.id ?? 0, payload),
    onSuccess: async () => {
      await props.onSaved();
      message.success('基本信息已保存');
    },
    onError: (error) => {
      if (error.status === 409) {
        props.onConflict();
        return;
      }
      message.error(error.message);
    },
  });

  // 校验通过后二次确认再提交；409 关闭确认框交给刷新弹窗
  function handleFinish(values: BasicFormValues) {
    modal.confirm({
      title: '保存基本信息',
      content: '确认保存本次修改？',
      okText: '保存',
      cancelText: '取消',
      // 两个汉字的按钮不自动插空格，保持文案可被精确匹配与展示
      okButtonProps: { autoInsertSpace: false },
      onOk: async () => {
        try {
          await mutation.mutateAsync(toUpdatePayload(course, values));
        } catch (error) {
          if ((error as ApiError).status === 409) return;
          throw error;
        }
      },
    });
  }

  return (
    <div>
      {course.status === 'published' && (
        <Alert
          type="warning"
          showIcon
          message="已发布课程不可编辑，请先下架"
          style={{ marginBottom: 16 }}
        />
      )}
      {course.status === 'draft' && (course.chapters ?? []).length > 0 && (
        <Alert
          type="info"
          showIcon
          message="首个章节保存后课程类型不可修改"
          style={{ marginBottom: 16 }}
        />
      )}
      <Form<BasicFormValues>
        key={course.version ?? 0}
        form={form}
        layout="vertical"
        initialValues={{
          name: course.name,
          type: course.type ?? 'video',
          originalCents: course.originalCents ?? null,
          saleCents: course.saleCents ?? null,
          instructor: course.instructor ?? undefined,
          cover: toCoverValue(course),
          intro: course.intro ?? undefined,
          detailRich: course.detailRich ?? '',
        }}
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
          <Input disabled={!fields.name} />
        </Form.Item>
        <Form.Item name="type" label="课程类型">
          <Select options={TYPE_OPTIONS} disabled={!fields.type} />
        </Form.Item>
        <Form.Item
          name="originalCents"
          label="原价"
          rules={[{ required: true, message: '请输入原价' }]}
        >
          <MoneyInput disabled={!fields.originalCents} placeholder="原价（元）" />
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
          <MoneyInput disabled={!fields.saleCents} placeholder="售价（元）" />
        </Form.Item>
        <Form.Item name="instructor" label="讲师">
          <Input disabled={!fields.instructor} />
        </Form.Item>
        <Form.Item name="cover" label="封面">
          <ImageUploader disabled={!fields.cover} />
        </Form.Item>
        <Form.Item name="intro" label="简介">
          <Input.TextArea rows={3} maxLength={200} disabled={!fields.intro} />
        </Form.Item>
        <Form.Item name="detailRich" label="详细介绍">
          <RichTextEditor disabled={!fields.detailRich} />
        </Form.Item>
        {course.status !== 'published' && (
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={mutation.isPending}
            >
              保存基本信息
            </Button>
          </Space>
        )}
      </Form>
    </div>
  );
}
