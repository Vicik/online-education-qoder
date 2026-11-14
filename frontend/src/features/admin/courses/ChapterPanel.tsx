import { useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  List,
  Modal,
  Space,
  Typography,
} from 'antd';
import { useMutation } from '@tanstack/react-query';
import {
  addChapter,
  deleteChapter,
  reorderChapters,
  updateChapter,
} from '@/api/admin/courses';
import type { ApiError } from '@/api/errors';
import type {
  AdminChapter,
  AdminCourseDetail,
  ChapterCreateInput,
  ChapterUpdateInput,
} from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { MediaUploader } from '@/components/common/MediaUploader';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';

// 章节弹窗表单值
interface ChapterFormValues {
  title: string;
  content: string;
}

// 课程类型到章节类型文案
const CONTENT_TYPE_LABEL: Record<'video' | 'audio', string> = {
  video: '视频',
  audio: '音频',
};

// 章节维护：增删改与上下移动排序，已发布课程只读
export function ChapterPanel(props: {
  course: AdminCourseDetail;
  onChanged: () => Promise<void>;
  onConflict: () => void;
}) {
  // 当前课程详情
  const { course } = props;
  // 章节列表：schema 字段可选，按空列表兜底
  const chapters = course.chapters ?? [];
  // 课程类型：章节类型始终跟随课程
  const courseType = course.type ?? 'video';
  // AntD 消息
  const { message } = AntdApp.useApp();
  // 当前编辑的章节；null 表示新增
  const [editing, setEditing] = useState<AdminChapter | null>(null);
  // 弹窗是否打开
  const [open, setOpen] = useState(false);
  // 弹窗表单
  const [form] = Form.useForm<ChapterFormValues>();
  // 已发布课程不可维护章节
  const readOnly = course.status === 'published';

  // 写操作错误：409 走刷新提示，其余提示消息
  function handleError(error: ApiError) {
    if (error.status === 409) {
      props.onConflict();
      return;
    }
    message.error(error.message);
  }

  // 新增章节：创建类 POST 携带幂等键
  const addMutation = useIdempotentMutation<AdminChapter, ChapterCreateInput>(
    (payload, key) => addChapter(course.id ?? 0, payload, key),
    {
      onSuccess: async () => {
        setOpen(false);
        await props.onChanged();
        message.success('章节已新增');
      },
      onError: handleError,
    },
  );

  // 编辑章节
  const updateMutation = useMutation<
    AdminChapter,
    ApiError,
    { chapterId: number; input: ChapterUpdateInput }
  >({
    mutationFn: ({ chapterId, input }) =>
      updateChapter(course.id ?? 0, chapterId, input),
    onSuccess: async () => {
      setOpen(false);
      await props.onChanged();
      message.success('章节已保存');
    },
    onError: handleError,
  });

  // 删除章节
  const deleteMutation = useMutation<void, ApiError, number>({
    mutationFn: (chapterId) => deleteChapter(course.id ?? 0, chapterId),
    onSuccess: async () => {
      await props.onChanged();
      message.success('章节已删除');
    },
    onError: handleError,
  });

  // 排序：提交完整 id 顺序，服务端重编号
  const reorderMutation = useMutation<AdminChapter[], ApiError, number[]>({
    mutationFn: (orderedChapterIds) =>
      reorderChapters(course.id ?? 0, orderedChapterIds),
    onSuccess: async () => {
      await props.onChanged();
      message.success('排序已保存');
    },
    onError: handleError,
  });

  // 打开新增弹窗：表单实例跨弹窗复用，需显式清空上次输入
  function openCreate() {
    setEditing(null);
    form.setFieldsValue({ title: '', content: '' });
    setOpen(true);
  }

  // 打开编辑弹窗：标题与正文都回填，正文沿用已保存的媒体 key
  function openEdit(chapter: AdminChapter) {
    setEditing(chapter);
    form.setFieldsValue({
      title: chapter.title ?? '',
      content: chapter.content ?? '',
    });
    setOpen(true);
  }

  // 提交弹窗：新增带 contentType；正文必填，编辑时原样带回或替换
  async function handleSubmit() {
    // 表单值：校验失败时错误已展示在表单上，直接结束
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    // 去除首尾空白的标题
    const title = values.title.trim();
    // 去除首尾空白的正文（媒体 key）
    const content = values.content.trim();
    try {
      if (editing) {
        // 编辑载荷：正文始终提交，未更换时即原 key
        const input: ChapterUpdateInput = { title, content };
        await updateMutation.mutateAsync({ chapterId: editing.id ?? 0, input });
        return;
      }
      // 新增载荷：章节类型跟随课程类型
      const input: ChapterCreateInput = {
        title,
        contentType: courseType,
        content,
      };
      await addMutation.mutateAsync(input);
    } catch (error) {
      // 409 已由 handleError 打开刷新弹窗，关闭当前弹窗即可
      if ((error as ApiError).status === 409) return;
      throw error;
    }
  }

  // 上移/下移：交换相邻 id 后提交完整顺序
  function move(index: number, offset: number) {
    // 当前章节 id 顺序
    const ids = chapters.map((chapter) => chapter.id ?? 0);
    // 目标位置
    const next = index + offset;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    void reorderMutation.mutateAsync(ids);
  }

  return (
    <div>
      {readOnly ? (
        <Alert
          type="warning"
          showIcon
          message="课程已发布，请先下架后再维护章节"
          style={{ marginBottom: 16 }}
        />
      ) : (
        <Button
          type="primary"
          onClick={openCreate}
          style={{ marginBottom: 16 }}
        >
          新增章节
        </Button>
      )}
      <List
        dataSource={chapters}
        locale={{ emptyText: '还没有章节' }}
        renderItem={(chapter, index) => (
          <Card key={chapter.id} style={{ marginBottom: 12 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text strong>
                {chapter.sortOrder}. {chapter.title}
              </Typography.Text>
              <Typography.Text type="secondary">
                内容类型：{CONTENT_TYPE_LABEL[chapter.contentType ?? courseType]}
              </Typography.Text>
              {!readOnly && (
                <Space>
                  <Button
                    size="small"
                    autoInsertSpace={false}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    上移
                  </Button>
                  <Button
                    size="small"
                    autoInsertSpace={false}
                    disabled={index === chapters.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    下移
                  </Button>
                  <Button
                    size="small"
                    autoInsertSpace={false}
                    onClick={() => openEdit(chapter)}
                  >
                    编辑
                  </Button>
                  <ConfirmAction
                    title="删除章节"
                    content={`删除「${chapter.title}」后其余章节将从 1 重新编号，确认删除？`}
                    danger
                    onConfirm={async () => {
                      try {
                        await deleteMutation.mutateAsync(chapter.id ?? 0);
                      } catch (error) {
                        // 409 由 handleError 打开刷新弹窗，确认框直接关闭
                        if ((error as ApiError).status === 409) return;
                        throw error;
                      }
                    }}
                  >
                    <Button size="small" danger autoInsertSpace={false}>
                      删除
                    </Button>
                  </ConfirmAction>
                </Space>
              )}
            </Space>
          </Card>
        )}
      />

      <Modal
        title={editing ? '编辑章节' : '新增章节'}
        open={open}
        destroyOnClose
        confirmLoading={addMutation.isPending || updateMutation.isPending}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ autoInsertSpace: false }}
        cancelButtonProps={{ autoInsertSpace: false }}
        onOk={() => void handleSubmit()}
        onCancel={() => setOpen(false)}
      >
        <Form<ChapterFormValues>
          key={editing ? `edit-${editing.id}` : 'create'}
          form={form}
          layout="vertical"
          initialValues={{ title: editing?.title ?? '', content: editing?.content ?? '' }}
        >
          <Form.Item
            name="title"
            label="章节标题"
            rules={[
              { required: true, whitespace: true, message: '请输入章节标题' },
              { max: 60, message: '最多 60 个字符' },
            ]}
          >
            <Input placeholder="请输入章节标题" />
          </Form.Item>
          <Form.Item label="内容类型">
            <Input value={CONTENT_TYPE_LABEL[courseType]} disabled />
          </Form.Item>
          <Form.Item
            name="content"
            label="正文"
            rules={[{ required: true, message: '请上传章节正文（视频/音频）' }]}
            extra={
              editing
                ? '已回填原正文；重新上传将整体替换'
                : '必填；先上传视频/音频再保存'
            }
          >
            <MediaUploader kind={courseType} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
