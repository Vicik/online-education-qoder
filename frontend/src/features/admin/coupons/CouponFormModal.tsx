import { App as AntdApp, Button, Form, Modal } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { createCouponTemplate } from '@/api/admin/coupons';
import type { AdminCouponTemplate } from '@/api/types';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { CouponFormFields } from './CouponFormFields';
import { toCouponCreatePayload, type CouponFormValues } from './payload';

// 创建弹窗属性
export function CouponFormModal(props: {
  open: boolean;
  onClose: () => void;
}) {
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 查询客户端
  const queryClient = useQueryClient();
  // 表单实例
  const [form] = Form.useForm<CouponFormValues>();

  // 创建：一次用户意图一个幂等键
  const create = useIdempotentMutation<AdminCouponTemplate, CouponFormValues>(
    (values, idempotencyKey) =>
      createCouponTemplate(toCouponCreatePayload(values), idempotencyKey),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });
        message.success('优惠券模板已创建');
        form.resetFields();
        props.onClose();
      },
      onError: (error) => message.error(error.message),
    },
  );

  // 校验通过后二次确认再提交
  function handleFinish(values: CouponFormValues) {
    modal.confirm({
      title: '创建优惠券模板',
      content: '确认创建该优惠券模板？创建后默认为停用状态。',
      okText: '确认创建',
      cancelText: '取消',
      onOk: async () => {
        await create.mutateAsync(values);
      },
    });
  }

  return (
    <Modal
      title="创建优惠券"
      open={props.open}
      onCancel={props.onClose}
      destroyOnClose
      footer={[
        <Button key="cancel" autoInsertSpace={false} onClick={props.onClose}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          autoInsertSpace={false}
          loading={create.isPending}
          onClick={() => form.submit()}
        >
          创建
        </Button>,
      ]}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ enableOnCreate: false, totalQty: 1 }}
        onFinish={handleFinish}
      >
        <CouponFormFields mode="create" />
      </Form>
    </Modal>
  );
}
