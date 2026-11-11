import { App as AntdApp, Alert, Button, Form, Space, Spin } from 'antd';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disableCouponTemplate,
  enableCouponTemplate,
  getCouponTemplate,
  updateCouponTemplate,
} from '@/api/admin/coupons';
import type { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { AdminCouponTemplate } from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { PageHeader } from '@/components/common/PageHeader';
import { CouponFormFields } from './CouponFormFields';
import {
  toCouponFormValues,
  toCouponUpdatePayload,
  type CouponFormValues,
} from './payload';

// 优惠券编辑页：启用态只读，停用态可保存；启停后重取详情
export default function CouponEditPage() {
  // 路由参数
  const params = useParams();
  // 模板 id
  const templateId = Number(params.id);
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 查询客户端
  const queryClient = useQueryClient();
  // 表单实例
  const [form] = Form.useForm<CouponFormValues>();

  // 模板详情：version 的唯一来源
  const query = useQuery({
    queryKey: queryKeys.adminCoupon(templateId),
    queryFn: () => getCouponTemplate(templateId),
    enabled: Number.isInteger(templateId) && templateId > 0,
  });
  // 当前模板
  const template = query.data;

  // 统一刷新列表与详情
  async function refreshCoupons() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });
  }

  // 409 刷新弹窗：刷新后重取详情与列表
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
        templateId,
        toCouponUpdatePayload(values, template!.version ?? 0),
      ),
    onSuccess: async () => {
      await refreshCoupons();
      message.success('优惠券模板已保存');
    },
    onError: (error) => {
      if (error.status === 409) {
        showConflict();
        return;
      }
      message.error(error.message);
    },
  });

  // 启用：停用态可启用
  const enable = useMutation<AdminCouponTemplate, ApiError, void>({
    mutationFn: () => enableCouponTemplate(templateId),
    onSuccess: async () => {
      await refreshCoupons();
      message.success('优惠券已启用');
    },
    onError: (error) => {
      if (error.status === 409) {
        showConflict();
        return;
      }
      message.error(error.message);
    },
  });

  // 停用：启用态可停用，级联失效由服务端执行
  const disable = useMutation<AdminCouponTemplate, ApiError, void>({
    mutationFn: () => disableCouponTemplate(templateId),
    onSuccess: async () => {
      await refreshCoupons();
      message.success('优惠券已停用');
    },
    onError: (error) => {
      if (error.status === 409) {
        showConflict();
        return;
      }
      message.error(error.message);
    },
  });

  // 详情加载中或失败：只渲染加载/空态
  if (!template) {
    return (
      <div>
        <PageHeader title="优惠券编辑" />
        {query.isError ? (
          <Alert
            type="error"
            showIcon
            message="优惠券模板加载失败"
            description={query.error.message}
            action={
              <Button onClick={() => void query.refetch()}>重试</Button>
            }
          />
        ) : (
          <Spin />
        )}
      </div>
    );
  }

  // 启用态只读
  const readOnly = template.status === 'enabled';

  // 校验通过后二次确认再保存
  function handleFinish(values: CouponFormValues) {
    modal.confirm({
      title: '保存优惠券模板',
      content: '确认保存本次修改？',
      okText: '确认保存',
      cancelText: '取消',
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

  return (
    <div>
      <PageHeader
        title="优惠券编辑"
        extra={
          <Space>
            <Link to="/admin/coupons">
              <Button>返回列表</Button>
            </Link>
            {readOnly ? (
              <ConfirmAction
                title="停用优惠券"
                content="停用后，未使用和已恢复的优惠券将永久失效且不可恢复，确认继续？"
                okText="确认停用"
                danger
                onConfirm={async () => {
                  await disable.mutateAsync();
                }}
              >
                <Button danger>停用</Button>
              </ConfirmAction>
            ) : (
              <ConfirmAction
                title="启用优惠券"
                content="确认启用该模板？启用后用户即可领取。"
                okText="确认启用"
                onConfirm={async () => {
                  await enable.mutateAsync();
                }}
              >
                <Button>启用</Button>
              </ConfirmAction>
            )}
          </Space>
        }
      />
      {readOnly && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="模板已启用，请先停用后再编辑"
          description="停用后未使用和已恢复的优惠券将永久失效。"
        />
      )}
      <Form
        key={template.version ?? 'detail'}
        form={form}
        layout="vertical"
        initialValues={toCouponFormValues(template)}
        onFinish={handleFinish}
        style={{ maxWidth: 560 }}
      >
        <CouponFormFields mode="edit" disabled={readOnly} />
        <Button
          type="primary"
          htmlType="submit"
          autoInsertSpace={false}
          disabled={readOnly}
          loading={save.isPending}
        >
          保存
        </Button>
      </Form>
    </div>
  );
}
