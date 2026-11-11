import { DatePicker, Form, Input, InputNumber, Switch } from 'antd';
import type { Dayjs } from 'dayjs';
import { MoneyInput } from '@/components/common/MoneyInput';
import { CourseMultiSelect } from '../promotions/shared';

// 表单字段属性：create 模式展示「创建后启用」开关
export function CouponFormFields(props: {
  mode: 'create' | 'edit';
  disabled?: boolean;
}) {
  // 是否创建模式
  const isCreate = props.mode === 'create';
  return (
    <>
      <Form.Item
        label="券名称"
        name="name"
        rules={[{ required: true, whitespace: true, message: '请填写券名称' }]}
      >
        <Input maxLength={40} disabled={props.disabled} />
      </Form.Item>
      <Form.Item
        label="抵扣面额"
        name="discountCents"
        rules={[{ required: true, message: '请填写抵扣面额' }]}
      >
        <MoneyInput placeholder="面额（元）" disabled={props.disabled} />
      </Form.Item>
      <Form.Item
        label="生效时间"
        name="startAt"
        rules={[{ required: true, message: '请选择生效时间' }]}
      >
        <DatePicker
          showTime
          format="YYYY-MM-DD HH:mm:ss"
          placeholder="开始时间"
          style={{ width: '100%' }}
          disabled={props.disabled}
        />
      </Form.Item>
      <Form.Item
        label="失效时间"
        name="endAt"
        dependencies={['startAt']}
        rules={[
          { required: true, message: '请选择失效时间' },
          ({ getFieldValue }) => ({
            validator(_rule, value: Dayjs | null) {
              // 生效时间
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
          disabled={props.disabled}
        />
      </Form.Item>
      <Form.Item
        label="发放总量"
        name="totalQty"
        rules={[{ required: true, message: '请填写发放总量' }]}
      >
        <InputNumber
          min={1}
          precision={0}
          style={{ width: '100%' }}
          disabled={props.disabled}
        />
      </Form.Item>
      <Form.Item
        label="适用课程"
        name="courseIds"
        rules={[{ required: true, message: '请选择适用课程' }]}
      >
        <CourseMultiSelect disabled={props.disabled} />
      </Form.Item>
      {isCreate && (
        <Form.Item
          label="创建后立即启用"
          name="enableOnCreate"
          valuePropName="checked"
        >
          <Switch disabled={props.disabled} />
        </Form.Item>
      )}
    </>
  );
}
