import { Button, Form, Input, InputNumber, Select, Space, Typography } from 'antd';
import { validatePassScore } from '@/lib/validators';
import { QuestionOrderList } from './QuestionOrderList';
import { totalScoreOf, type ExamFormValues } from './payload';
import { useQuestionPool } from './useQuestionPool';

// 考试表单：创建与草稿编辑共用；发布/结束后只读
export function ExamForm(props: {
  mode: 'create' | 'edit';
  initialValues?: ExamFormValues;
  readOnly?: boolean;
  submitting: boolean;
  onSubmit: (values: ExamFormValues) => void | Promise<void>;
  onCancel: () => void;
}) {
  // 表单实例
  const [form] = Form.useForm<ExamFormValues>();
  // 题目池
  const pool = useQuestionPool();
  // 已选题目 id（按出题顺序）
  const questionIds = (Form.useWatch('questionIds', form) ?? []) as number[];
  // 题目池数据
  const questions = pool.data?.items ?? [];
  // 实时总分
  const totalScore = totalScoreOf(questions, questionIds);
  // 只读状态
  const readOnly = props.readOnly ?? false;

  // 题目下拉选项：已选的停用题目仍可移除
  const options = questions.map((question) => ({
    value: question.id ?? 0,
    label: `${question.stem ?? ''}（${question.score ?? 0} 分）`,
    disabled:
      question.status === 'disabled' && !questionIds.includes(question.id ?? 0),
  }));

  return (
    <Form<ExamFormValues>
      form={form}
      layout="vertical"
      initialValues={
        props.initialValues ?? {
          title: '',
          description: '',
          durationMin: 60,
          passScore: 1,
          questionIds: [],
        }
      }
      onFinish={props.onSubmit}
    >
      <Form.Item
        name="title"
        label="考试名称"
        rules={[{ required: true, message: '请输入考试名称' }]}
      >
        <Input disabled={readOnly} placeholder="例如：期中考试" />
      </Form.Item>
      <Form.Item name="description" label="考试说明">
        <Input.TextArea disabled={readOnly} rows={3} />
      </Form.Item>
      <Form.Item
        name="durationMin"
        label="考试时长（分钟）"
        rules={[{ required: true, message: '请输入考试时长' }]}
      >
        <InputNumber
          disabled={readOnly}
          min={1}
          precision={0}
          style={{ width: 200 }}
        />
      </Form.Item>
      <Form.Item
        name="questionIds"
        label="组卷题目"
        rules={[
          {
            validator: (_, value: number[] | undefined) =>
              value && value.length > 0
                ? Promise.resolve()
                : Promise.reject(new Error('请至少选择一道题')),
          },
        ]}
      >
        <Select
          mode="multiple"
          showSearch
          optionFilterProp="label"
          aria-label="组卷题目"
          placeholder="选择题库中已启用的题目"
          options={options}
          disabled={readOnly}
          loading={pool.isLoading}
          notFoundContent={pool.isError ? '题目加载失败' : '暂无可选题目'}
        />
      </Form.Item>
      <QuestionOrderList
        questions={questions}
        value={questionIds}
        onChange={(ids) => form.setFieldValue('questionIds', ids)}
        readOnly={readOnly}
      />
      <Typography.Paragraph data-testid="exam-total">
        试卷总分：{totalScore} 分
      </Typography.Paragraph>
      <Form.Item
        name="passScore"
        label="及格分"
        dependencies={['questionIds']}
        rules={[
          { required: true, message: '请输入及格分' },
          () => ({
            validator: (_, value: number | null) => {
              if (value === null || value === undefined) {
                return Promise.resolve();
              }
              // 及格分 >0 且 ≤总分
              const message = validatePassScore(value, totalScore);
              return message
                ? Promise.reject(new Error(message))
                : Promise.resolve();
            },
          }),
        ]}
      >
        <InputNumber
          disabled={readOnly}
          min={1}
          precision={0}
          style={{ width: 200 }}
        />
      </Form.Item>
      <Space>
        {readOnly ? (
          <Button onClick={props.onCancel}>返回列表</Button>
        ) : (
          <>
            <Button
              type="primary"
              htmlType="submit"
              loading={props.submitting}
              autoInsertSpace={false}
            >
              {props.mode === 'create' ? '创建考试' : '保存'}
            </Button>
            <Button onClick={props.onCancel} autoInsertSpace={false}>
              取消
            </Button>
          </>
        )}
      </Space>
    </Form>
  );
}
