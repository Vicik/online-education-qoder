import { App as AntdApp, Card } from 'antd';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { createQuestion } from '@/api/admin/questions';
import type { AdminQuestion, QuestionCreateInput } from '@/api/types';
import { PageHeader } from '@/components/common/PageHeader';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { QuestionForm } from './QuestionForm';
import { toQuestionCreatePayload, type QuestionFormValues } from './payload';

// 创建题目：确认后提交，成功后回到列表
export default function QuestionCreatePage() {
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 路由跳转
  const navigate = useNavigate();
  // 查询缓存
  const queryClient = useQueryClient();

  // 创建 Mutation：携带幂等键
  const createMutation = useIdempotentMutation<AdminQuestion, QuestionCreateInput>(
    (payload, key) => createQuestion(payload, key),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: ['admin', 'questions'] });
        message.success('题目已创建');
        navigate('/admin/questions');
      },
      onError: (error) => message.error(error.message),
    },
  );

  // 校验通过后二次确认
  function handleSubmit(values: QuestionFormValues) {
    modal.confirm({
      title: '创建题目',
      content: '分值创建后不可修改，确认创建？',
      okText: '确认创建',
      cancelText: '取消',
      cancelButtonProps: { autoInsertSpace: false },
      onOk: () => createMutation.mutateAsync(toQuestionCreatePayload(values)),
    });
  }

  return (
    <div>
      <PageHeader title="创建题目" />
      <Card>
        <QuestionForm
          mode="create"
          submitting={createMutation.isPending}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/admin/questions')}
        />
      </Card>
    </div>
  );
}
