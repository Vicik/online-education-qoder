import {
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Radio,
  Space,
  Typography,
} from 'antd';
import type { AdminQuestionType } from '@/api/types';
import {
  buildAnswerOptions,
  nextOptionKey,
  type QuestionFormValues,
} from './payload';

// 单选答案适配器：把数组值收敛为单个 key
function SingleAnswer(props: {
  options: Array<{ value: string; label: string }>;
  value?: string[];
  onChange?: (value: string[]) => void;
}) {
  return (
    <Radio.Group
      options={props.options}
      value={props.value?.[0]}
      onChange={(event) => props.onChange?.([event.target.value as string])}
    />
  );
}

// 题目表单：创建与编辑共用；编辑时分值只读
export function QuestionForm(props: {
  mode: 'create' | 'edit';
  initialValues?: QuestionFormValues;
  submitting: boolean;
  onSubmit: (values: QuestionFormValues) => void | Promise<void>;
  onCancel: () => void;
}) {
  // 表单实例
  const [form] = Form.useForm<QuestionFormValues>();
  // 当前题型
  const type = (Form.useWatch('type', form) ??
    props.initialValues?.type ??
    'single') as AdminQuestionType;
  // 当前选项
  const options = (Form.useWatch('options', form) ??
    props.initialValues?.options ??
    []) as QuestionFormValues['options'];
  // 答案选择项
  const answerOptions = buildAnswerOptions(options);

  // 题型变化清空答案；删除选项时移除失效答案
  function handleValuesChange(changed: Partial<QuestionFormValues>) {
    if ('type' in changed) form.setFieldValue('answer', []);
    if ('options' in changed) {
      // 仍存在的选项 key
      const keys = (changed.options ?? []).map((option) => option.key);
      // 当前答案
      const current = (form.getFieldValue('answer') as string[] | undefined) ?? [];
      form.setFieldValue('answer', current.filter((key) => keys.includes(key)));
    }
  }

  return (
    <Form<QuestionFormValues>
      form={form}
      layout="vertical"
      initialValues={
        props.initialValues ?? {
          type: 'single',
          stem: '',
          options: [
            { key: 'A', text: '' },
            { key: 'B', text: '' },
          ],
          answer: [],
          score: 1,
          analysis: '',
        }
      }
      onValuesChange={handleValuesChange}
      onFinish={props.onSubmit}
    >
      <Form.Item
        name="type"
        label="题型"
        rules={[{ required: true, message: '请选择题型' }]}
      >
        <Radio.Group
          options={[
            { value: 'single', label: '单选' },
            { value: 'multiple', label: '多选' },
          ]}
        />
      </Form.Item>
      <Form.Item
        name="stem"
        label="题干"
        rules={[{ required: true, whitespace: true, message: '请输入题干' }]}
      >
        <Input.TextArea rows={3} placeholder="输入题目内容" />
      </Form.Item>
      <Form.Item label="选项（2–6 个，key 固定为 A–F）" required>
        <Form.List name="options">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field, index) => (
                <Space
                  key={field.key}
                  align="baseline"
                  style={{ display: 'flex', marginBottom: 8 }}
                >
                  <Typography.Text strong>
                    {options[index]?.key ?? '-'}
                  </Typography.Text>
                  <Form.Item name={[field.name, 'key']} hidden>
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, 'text']}
                    style={{ marginBottom: 0 }}
                    rules={[{ required: true, whitespace: true, message: '请输入选项内容' }]}
                  >
                    <Input
                      placeholder={`选项 ${options[index]?.key ?? ''}`}
                      style={{ width: 420 }}
                    />
                  </Form.Item>
                  <Button
                    danger
                    disabled={fields.length <= 2}
                    onClick={() => remove(field.name)}
                  >
                    删除选项
                  </Button>
                </Space>
              ))}
              <Button
                disabled={fields.length >= 6}
                onClick={() =>
                  add({
                    key: nextOptionKey(form.getFieldValue('options') ?? []),
                    text: '',
                  })
                }
              >
                添加选项
              </Button>
            </>
          )}
        </Form.List>
      </Form.Item>
      <Form.Item
        name="answer"
        label="正确答案"
        rules={[
          {
            validator: (_, value: string[] | undefined) => {
              // 当前所选答案
              const selected = value ?? [];
              if (selected.length === 0) {
                return Promise.reject(new Error('请选择正确答案'));
              }
              if (type === 'single' && selected.length !== 1) {
                return Promise.reject(new Error('单选题必须恰好有 1 个答案'));
              }
              if (type === 'multiple' && selected.length < 2) {
                return Promise.reject(new Error('多选题至少需要 2 个答案'));
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        {type === 'single' ? (
          <SingleAnswer options={answerOptions} />
        ) : (
          <Checkbox.Group options={answerOptions} />
        )}
      </Form.Item>
      <Form.Item
        name="score"
        label="分值"
        rules={[{ required: true, message: '请输入分值' }]}
      >
        <InputNumber
          min={1}
          precision={0}
          disabled={props.mode === 'edit'}
          style={{ width: 160 }}
        />
      </Form.Item>
      <Form.Item
        name="analysis"
        label="答案解析"
        rules={[{ required: true, whitespace: true, message: '请输入答案解析' }]}
      >
        <Input.TextArea rows={4} placeholder="交卷后向考生展示" />
      </Form.Item>
      <Space>
        <Button
          type="primary"
          htmlType="submit"
          loading={props.submitting}
          autoInsertSpace={false}
        >
          {props.mode === 'create' ? '创建题目' : '保存'}
        </Button>
        <Button onClick={props.onCancel} autoInsertSpace={false}>
          取消
        </Button>
      </Space>
    </Form>
  );
}
