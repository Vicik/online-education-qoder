import { Button, Tag, Typography } from 'antd';
import type { AdminQuestion } from '@/api/types';

// 已选题目顺序列表：上移/下移/移除；只读时隐藏操作
export function QuestionOrderList(props: {
  questions: AdminQuestion[];
  value: number[];
  onChange: (questionIds: number[]) => void;
  readOnly?: boolean;
}) {
  // 题目 id → 题目
  const byId = new Map<number, AdminQuestion>();
  props.questions.forEach((question) => {
    byId.set(question.id ?? 0, question);
  });

  // 交换相邻题目
  function move(from: number, to: number) {
    if (to < 0 || to >= props.value.length) return;
    const next = [...props.value];
    [next[from], next[to]] = [next[to], next[from]];
    props.onChange(next);
  }

  if (props.value.length === 0) {
    return <Typography.Text type="secondary">尚未选择题目</Typography.Text>;
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {props.value.map((questionId, index) => {
        // 当前题目
        const question = byId.get(questionId);
        return (
          <div
            key={questionId}
            data-testid={`question-order-${questionId}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
          >
            <Typography.Text ellipsis style={{ flex: 1 }}>
              {index + 1}. {question?.stem ?? `题目 ${questionId}`}（
              {question?.score ?? 0} 分）
            </Typography.Text>
            {question?.status === 'disabled' && <Tag>已停用</Tag>}
            {!props.readOnly && (
              <>
                <Button
                  size="small"
                  disabled={index === 0}
                  autoInsertSpace={false}
                  onClick={() => move(index, index - 1)}
                >
                  上移
                </Button>
                <Button
                  size="small"
                  disabled={index === props.value.length - 1}
                  autoInsertSpace={false}
                  onClick={() => move(index, index + 1)}
                >
                  下移
                </Button>
                <Button
                  size="small"
                  danger
                  autoInsertSpace={false}
                  onClick={() =>
                    props.onChange(props.value.filter((id) => id !== questionId))
                  }
                >
                  移除
                </Button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
