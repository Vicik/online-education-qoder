import { useEffect } from 'react';
import { App as AntdApp, Button, Form, Input, Modal, Select, Space } from 'antd';
import { ApiError } from '@/api/errors';
import type { AdminBlockedWord, BlockedWordStatus } from '@/api/types';

// 屏蔽词表单值
export interface BlockedWordFormValues {
  word: string;
  status?: BlockedWordStatus;
}

// 新增/编辑屏蔽词弹窗：重复词 409 转为字段错误
export function BlockedWordFormModal(props: {
  open: boolean;
  editing: AdminBlockedWord | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: BlockedWordFormValues) => Promise<void>;
}) {
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 表单实例
  const [form] = Form.useForm<BlockedWordFormValues>();

  // 打开时回填
  useEffect(() => {
    if (!props.open) return;
    form.setFieldsValue(
      props.editing
        ? { word: props.editing.word ?? '', status: props.editing.status ?? 'enabled' }
        : { word: '', status: 'enabled' },
    );
  }, [props.open, props.editing, form]);

  // 校验通过后二次确认
  function handleFinish(values: BlockedWordFormValues) {
    modal.confirm({
      title: props.editing ? '保存屏蔽词' : '新增屏蔽词',
      content: '修改后立即影响用户端内容校验，确认保存？',
      okText: '确认保存',
      cancelText: '取消',
      cancelButtonProps: { autoInsertSpace: false },
      onOk: async () => {
        try {
          await props.onSubmit({
            word: values.word.trim(),
            ...(props.editing ? { status: values.status ?? 'enabled' } : {}),
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            form.setFields([{ name: 'word', errors: ['该屏蔽词已存在'] }]);
            return;
          }
          message.error(error instanceof Error ? error.message : '保存失败');
          throw error;
        }
      },
    });
  }

  return (
    <Modal
      open={props.open}
      title={props.editing ? '编辑屏蔽词' : '新增屏蔽词'}
      onCancel={props.onCancel}
      footer={null}
      destroyOnClose
    >
      <Form<BlockedWordFormValues>
        form={form}
        layout="vertical"
        onFinish={handleFinish}
      >
        <Form.Item
          name="word"
          label="屏蔽词"
          rules={[
            { required: true, whitespace: true, message: '请输入屏蔽词' },
            { max: 100, message: '最多 100 个字符' },
          ]}
        >
          <Input placeholder="输入需要屏蔽的词" />
        </Form.Item>
        {props.editing && (
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'enabled', label: '已启用' },
                { value: 'disabled', label: '已停用' },
              ]}
            />
          </Form.Item>
        )}
        <Space>
          <Button
            type="primary"
            htmlType="submit"
            loading={props.submitting}
            autoInsertSpace={false}
          >
            保存
          </Button>
          <Button onClick={props.onCancel} autoInsertSpace={false}>
            取消
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}
