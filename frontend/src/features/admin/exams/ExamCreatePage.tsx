import { App as AntdApp, Card } from 'antd';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { createExam } from '@/api/admin/exams';
import type { AdminExamDetail, ExamCreateInput } from '@/api/types';
import { PageHeader } from '@/components/common/PageHeader';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { ExamForm } from './ExamForm';
import { toExamCreatePayload, type ExamFormValues } from './payload';

// 创建考试：确认后提交草稿，成功回到列表
export default function ExamCreatePage() {
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 路由跳转
  const navigate = useNavigate();
  // 查询缓存
  const queryClient = useQueryClient();

  // 创建 Mutation：携带幂等键
  const createMutation = useIdempotentMutation<
    AdminExamDetail,
    ExamCreateInput
  >((payload, key) => createExam(payload, key), {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'exams'] });
      message.success('考试已创建为草稿');
      navigate('/admin/exams');
    },
    onError: (error) => message.error(error.message),
  });

  // 校验通过后二次确认
  function handleSubmit(values: ExamFormValues) {
    modal.confirm({
      title: '创建考试',
      content: '将按当前题目顺序创建草稿考试，确认创建？',
      okText: '确认创建',
      cancelText: '取消',
      cancelButtonProps: { autoInsertSpace: false },
      onOk: () => createMutation.mutateAsync(toExamCreatePayload(values)),
    });
  }

  return (
    <div>
      <PageHeader title="创建考试" />
      <Card>
        <ExamForm
          mode="create"
          submitting={createMutation.isPending}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/admin/exams')}
        />
      </Card>
    </div>
  );
}
