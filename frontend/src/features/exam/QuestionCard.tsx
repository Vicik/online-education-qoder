import { Card, Checkbox, Radio, Space, Typography } from 'antd';
import type { ExamQuestion } from '@/api/types';

// 单题作答：单选用 Radio，多选用 Checkbox；作答阶段不展示答案
export function QuestionCard(props: {
  index: number;
  question: ExamQuestion;
  value: string[];
  onChange: (answers: string[]) => void;
}) {
  // 当前题目
  const { question } = props;
  // 选项列表：接口字段可选，缺省按空处理
  const options = question.options ?? [];

  return (
    <Card
      title={`第 ${props.index} 题（${question.type === 'single' ? '单选' : '多选'}，${question.score} 分）`}
      style={{ marginBottom: 12 }}
    >
      <Typography.Paragraph>{question.stem}</Typography.Paragraph>
      {question.type === 'single' ? (
        <Radio.Group
          value={props.value[0]}
          onChange={(event) => props.onChange([event.target.value as string])}
        >
          <Space direction="vertical">
            {options.map((option) => (
              <Radio key={option.key} value={option.key}>
                {option.key}. {option.text}
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      ) : (
        <Checkbox.Group
          value={props.value}
          onChange={(values) => props.onChange(values as string[])}
        >
          <Space direction="vertical">
            {options.map((option) => (
              <Checkbox key={option.key} value={option.key}>
                {option.key}. {option.text}
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      )}
    </Card>
  );
}
