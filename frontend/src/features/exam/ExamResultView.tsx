import { Button, Card, Space, Tag, Typography } from 'antd';
import type { AttemptResultData } from '@/api/types';
import { PageHeader } from '@/components/common/PageHeader';
import { formatShanghai } from '@/lib/datetime';

// 成绩详情：总分、及格标签、逐题作答与解析
export function ExamResultView(props: {
  result: AttemptResultData;
  onBack: () => void;
}) {
  // 成绩数据
  const { result } = props;
  // 逐题成绩：接口字段可选，缺省按空处理
  const questions = result.questions ?? [];

  return (
    <div>
      <PageHeader
        title={`成绩：${result.examTitle}`}
        extra={<Button onClick={props.onBack}>返回考试列表</Button>}
      />
      <Card style={{ marginBottom: 16 }}>
        <Space size={24} wrap>
          <Typography.Text strong style={{ fontSize: 24 }}>
            {result.score} / {result.totalScore}
          </Typography.Text>
          <Tag color={result.passed ? 'green' : 'red'}>
            {result.passed ? '及格' : '不及格'}
          </Tag>
          <Typography.Text type="secondary">及格分 {result.passScore}</Typography.Text>
          <Typography.Text type="secondary">
            交卷时间 {result.submittedAt ? formatShanghai(result.submittedAt) : '—'}
          </Typography.Text>
        </Space>
      </Card>

      {questions.map((question, index) => {
        // 选项列表：接口字段可选，缺省按空处理
        const options = question.options ?? [];
        // 用户作答：接口字段可选，缺省按未作答处理
        const userAnswers = question.userAnswers ?? [];
        // 正确答案：接口字段可选，缺省按空处理
        const correctAnswers = question.correctAnswers ?? [];
        return (
          <Card key={question.id} title={`第 ${index + 1} 题`} style={{ marginBottom: 12 }}>
            <Typography.Paragraph>{question.stem}</Typography.Paragraph>
            <Space direction="vertical">
              {options.map((option) => {
                // 是否正确答案
                const correct = correctAnswers.includes(option.key ?? '');
                // 是否被用户选中
                const chosen = userAnswers.includes(option.key ?? '');
                return (
                  <Tag key={option.key} color={correct ? 'green' : chosen ? 'red' : undefined}>
                    {option.key}. {option.text}
                  </Tag>
                );
              })}
            </Space>
            <Typography.Paragraph style={{ marginTop: 12 }}>
              你的答案：
              {userAnswers.length > 0 ? userAnswers.join('、') : '未作答'}
            </Typography.Paragraph>
            <Typography.Paragraph>
              正确答案：{correctAnswers.join('、')}
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary">
              解析：{question.analysis || '暂无解析'}
            </Typography.Paragraph>
          </Card>
        );
      })}
    </div>
  );
}
