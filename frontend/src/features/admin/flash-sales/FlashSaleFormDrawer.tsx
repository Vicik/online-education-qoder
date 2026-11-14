import { useEffect } from 'react';
import {
  App as AntdApp,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
} from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { createFlashSale, updateFlashSale } from '@/api/admin/flash-sales';
import type { ApiError } from '@/api/errors';
import type { AdminFlashSale } from '@/api/types';
import { MoneyInput } from '@/components/common/MoneyInput';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { CourseSelect } from '../promotions/shared';
import {
  disabledPastDate,
  disabledPastTime,
  toPickerValue,
} from '../promotions/time';
import {
  toFlashSaleCreatePayload,
  toFlashSaleUpdatePayload,
  type FlashSaleFormValues,
} from './payload';

// 抽屉属性：sale 为空表示创建
export function FlashSaleFormDrawer(props: {
  open: boolean;
  sale: AdminFlashSale | null;
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
}) {
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 查询客户端
  const queryClient = useQueryClient();
  // 表单实例
  const [form] = Form.useForm<FlashSaleFormValues>();
  // 是否编辑模式
  const isEdit = props.sale !== null;

  // 创建：一次用户意图一个幂等键
  const create = useIdempotentMutation<AdminFlashSale, FlashSaleFormValues>(
    (values, idempotencyKey) =>
      createFlashSale(toFlashSaleCreatePayload(values), idempotencyKey),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: ['admin', 'flash-sales'] });
        // 课程已关联新活动，刷新表单的课程选项
        await queryClient.invalidateQueries({ queryKey: ['admin', 'courses'] });
        message.success('秒杀活动已创建');
        props.onSaved();
      },
      onError: (error) => message.error(error.message),
    },
  );

  // 编辑：PUT 携带 version；409 交给父级刷新
  const update = useMutation<AdminFlashSale, ApiError, FlashSaleFormValues>({
    mutationFn: (values) =>
      updateFlashSale(
        props.sale!.id ?? 0,
        toFlashSaleUpdatePayload(values, props.sale!.version ?? 0),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'flash-sales'] });
      message.success('秒杀活动已保存');
      props.onSaved();
    },
    onError: (error) => {
      if (error.status === 409) {
        props.onConflict();
        return;
      }
      message.error(error.message);
    },
  });

  // 表单初始值：编辑回填，创建默认 1 件库存
  const initialValues = props.sale
    ? {
        courseId: props.sale.courseId,
        name: props.sale.name,
        priceCents: props.sale.priceCents,
        stock: props.sale.stock,
        startAt: toPickerValue(props.sale.startAt ?? ''),
        endAt: toPickerValue(props.sale.endAt ?? ''),
      }
    : { stock: 1 };

  // 每次打开抽屉重置表单：创建清空上次输入，编辑回填当前活动
  useEffect(() => {
    if (!props.open) return;
    form.resetFields();
    form.setFieldsValue(
      props.sale
        ? {
            courseId: props.sale.courseId,
            name: props.sale.name,
            priceCents: props.sale.priceCents,
            stock: props.sale.stock,
            startAt: toPickerValue(props.sale.startAt ?? ''),
            endAt: toPickerValue(props.sale.endAt ?? ''),
          }
        : {
            courseId: undefined,
            name: undefined,
            priceCents: undefined,
            stock: 1,
            startAt: undefined,
            endAt: undefined,
          },
    );
    // 仅在打开或编辑对象变化时重置，避免输入过程中被覆盖
  }, [form, props.open, props.sale]);

  // 校验通过后二次确认再提交
  function handleFinish(values: FlashSaleFormValues) {
    modal.confirm({
      title: isEdit ? '保存秒杀活动' : '创建秒杀活动',
      content: isEdit ? '确认保存本次活动修改？' : '确认创建该秒杀活动？',
      okText: isEdit ? '确认保存' : '确认创建',
      cancelText: '取消',
      onOk: async () => {
        try {
          await (isEdit
            ? update.mutateAsync(values)
            : create.mutateAsync(values));
        } catch (error) {
          if ((error as ApiError).status === 409) return;
          throw error;
        }
      },
    });
  }

  return (
    <Drawer
      title={isEdit ? '编辑秒杀活动' : '创建秒杀活动'}
      width={520}
      open={props.open}
      onClose={props.onClose}
      destroyOnClose
    >
      <Form
        key={props.sale?.id ?? 'create'}
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={handleFinish}
      >
        <Form.Item
          label="关联课程"
          name="courseId"
          rules={[{ required: true, message: '请选择关联课程' }]}
        >
          <CourseSelect
            disabled={isEdit}
            withoutActivePromotion={!isEdit}
          />
        </Form.Item>
        <Form.Item
          label="活动名称"
          name="name"
          rules={[{ required: true, whitespace: true, message: '请填写活动名称' }]}
        >
          <Input maxLength={40} placeholder="请输入活动名称" />
        </Form.Item>
        <Form.Item
          label="秒杀价"
          name="priceCents"
          rules={[{ required: true, message: '请填写秒杀价' }]}
        >
          <MoneyInput placeholder="秒杀价（元）" />
        </Form.Item>
        <Form.Item
          label="总库存"
          name="stock"
          rules={[
            { required: true, message: '请填写总库存' },
            ({ getFieldValue }) => ({
              validator() {
                // 当前库存输入
                const value = getFieldValue('stock') as number | null;
                // 编辑时下限为已售，创建时至少 1
                const minimum = props.sale?.sold ?? 1;
                if (value !== null && value !== undefined && value >= minimum) {
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(isEdit ? '库存不得小于已售' : '库存至少为 1'),
                );
              },
            }),
          ]}
        >
          <InputNumber
            min={0}
            precision={0}
            placeholder="请输入库存数量"
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item
          label="开始时间"
          name="startAt"
          rules={[{ required: true, message: '请选择开始时间' }]}
        >
          <DatePicker
            showTime
            format="YYYY-MM-DD HH:mm:ss"
            placeholder="开始时间"
            style={{ width: '100%' }}
            disabledDate={(current) => disabledPastDate(current)}
            disabledTime={(current) => disabledPastTime(current)}
          />
        </Form.Item>
        <Form.Item
          label="结束时间"
          name="endAt"
          dependencies={['startAt']}
          rules={[
            { required: true, message: '请选择结束时间' },
            ({ getFieldValue }) => ({
              validator(_rule, value: Dayjs | null) {
                // 开始时间
                const startAt = getFieldValue('startAt') as Dayjs | null;
                if (!value || !startAt || value.valueOf() > startAt.valueOf()) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error('结束时间必须晚于开始时间'));
              },
            }),
          ]}
        >
          <DatePicker
            showTime
            format="YYYY-MM-DD HH:mm:ss"
            placeholder="结束时间"
            style={{ width: '100%' }}
            disabledDate={(current) => disabledPastDate(current)}
            disabledTime={(current) => disabledPastTime(current)}
          />
        </Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          block
          autoInsertSpace={false}
          loading={create.isPending || update.isPending}
        >
          {isEdit ? '保存' : '创建'}
        </Button>
      </Form>
    </Drawer>
  );
}
