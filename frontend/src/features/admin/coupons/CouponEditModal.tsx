import { useEffect } from 'react';
import { App as AntdApp, Alert, Button, Form, Modal, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCouponTemplate, updateCouponTemplate } from '@/api/admin/coupons';
import type { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { AdminCouponTemplate } from '@/api/types';
import { CouponFormFields } from './CouponFormFields';
import {
  toCouponFormValues,
  toCouponUpdatePayload,
  type CouponFormValues,
} from './payload';

// 编辑弹窗属性：templateId 为 null 时关闭
export function CouponEditModal(props: {
  templateId: number | null;
  onClose: () => void;
}) {
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 查询客户端
  const queryClient = useQueryClient();
  // 表单实例
  const [form] = Form.useForm<CouponFormValues>();
  // 弹窗开关
  const open = props.templateId !== null;

  // 模板详情：version 的唯一来源，打开弹窗时拉取
  const query = useQuery({
    queryKey: queryKeys.adminCoupon(props.templateId ?? 0),
    queryFn: () => getCouponTemplate(props.templateId as number),
    enabled: open,
  });
  // 当前模板
  const template = query.data;

  // 回填：每次打开或详情更新时重置后写入，避免上次编辑残留
  useEffect(() => {
    if (!open || !template) return;
    form.resetFields();
    form.setFieldsValue(toCouponFormValues(template));
  }, [open, template, form]);

  // 统一刷新列表与详情
  function refreshCoupons() {
    return queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });
  }

  // 409 刷新弹窗：重取详情与列表，不覆盖他人修改
  function showConflict() {
    modal.confirm({
      title: '内容已在其他页面被修改',
      content: '请刷新后重试，系统不会自动覆盖他人修改。',
      okText: '刷新',
      cancelText: '取消',
      // 两个汉字的按钮不自动插空格，保持与 ConfirmAction 一致
      okButtonProps: { autoInsertSpace: false },
      cancelButtonProps: { autoInsertSpace: false },
      onOk: async () => {
        await refreshCoupons();
      },
    });
  }

  // 保存：仅停用态可提交，version 必带
  const save = useMutation<AdminCouponTemplate, ApiError, CouponFormValues>({
    mutationFn: (values) =>
      updateCouponTemplate(
        props.templateId as number,
        toCouponUpdatePayload(values, template?.version ?? 0),
      ),
    onSuccess: async () => {
      await refreshCoupons();
      message.success('优惠券模板已保存');
      props.onClose();
    },
    onError: (error) => {
      if (error.status === 409) {
        showConflict();
        return;
      }
      message.error(error.message);
    },
  });

  // 校验通过后二次确认再保存
  function handleFinish(values: CouponFormValues) {
    modal.confirm({
      title: '保存优惠券模板',
      content: '确认保存本次修改？',
      okText: '确认保存',
      cancelText: '取消',
      okButtonProps: { autoInsertSpace: false },
      cancelButtonProps: { autoInsertSpace: false },
      onOk: async () => {
        try {
          await save.mutateAsync(values);
        } catch (error) {
          if ((error as ApiError).status === 409) return;
          throw error;
        }
      },
    });
  }

  // 启用态只读，需先停用
  const readOnly = template?.status === 'enabled';
  // 保存按钮是否可用
  const saveDisabled = !template || readOnly;

  return (
    <Modal
      title="编辑优惠券"
      open={open}
      onCancel={props.onClose}
      destroyOnHidden
      footer={[
        <Button key="cancel" autoInsertSpace={false} onClick={props.onClose}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          autoInsertSpace={false}
          disabled={saveDisabled}
          loading={save.isPending}
          onClick={() => form.submit()}
        >
          保存
        </Button>,
      ]}
    >
      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message="优惠券模板加载失败"
          description={query.error.message}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      ) : !template ? (
        <Spin />
      ) : (
        <>
          {readOnly && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="模板已启用，请先停用后再编辑"
              description="停用后未使用和已恢复的优惠券将永久失效。"
            />
          )}
          <Form form={form} layout="vertical" onFinish={handleFinish}>
            <CouponFormFields mode="edit" disabled={readOnly} />
          </Form>
        </>
      )}
    </Modal>
  );
}
