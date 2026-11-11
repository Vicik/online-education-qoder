import { useState } from 'react';
import { Alert, App as AntdApp, Button, Card, Modal, Spin } from 'antd';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdminQuestion, updateQuestion } from '@/api/admin/questions';
import { queryKeys } from '@/api/query-keys';
import type { ApiError } from '@/api/errors';
import type { AdminQuestion, QuestionUpdateInput } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { QuestionForm } from './QuestionForm';
import {
  toQuestionFormValues,
  toQuestionUpdatePayload,
  type QuestionFormValues,
} from './payload';

// 编辑题目：分值只读；409 只提示刷新
export default function QuestionEditPage() {
  // 路由参数
  const params = useParams();
  // 题目 id
  const questionId = Number(params.id);
  // 返回列表
  const navigate = useNavigate();
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 查询缓存
  const queryClient = useQueryClient();
  // 版本冲突弹窗开关
  const [conflictOpen, setConflictOpen] = useState(false);

  // 题目详情
  const query = useQuery({
    queryKey: queryKeys.adminQuestion(questionId),
    queryFn: () => getAdminQuestion(questionId),
    enabled: Number.isInteger(questionId) && questionId > 0,
  });

  // 版本冲突：刷新详情，不自动覆盖
  function showConflict() {
    setConflictOpen(true);
  }

  // 刷新详情并关闭冲突弹窗
  function refreshAfterConflict() {
    setConflictOpen(false);
    void query.refetch();
  }

  // 保存题目：携带 version
  const updateMutation = useMutation<
    AdminQuestion,
    ApiError,
    QuestionUpdateInput
  >({
    mutationFn: (input) => updateQuestion(questionId, input),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.adminQuestion(questionId), updated);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'questions'] });
      message.success('题目已保存');
    },
    onError: (error) => {
      if (error.status === 409) {
        showConflict();
        return;
      }
      message.error(error.message);
    },
  });

  // 校验通过后二次确认
  function handleSubmit(values: QuestionFormValues) {
    modal.confirm({
      title: '保存题目',
      content: '保存后立即生效，确认保存？',
      okText: '确认保存',
      cancelText: '取消',
      cancelButtonProps: { autoInsertSpace: false },
      onOk: () =>
        updateMutation.mutateAsync(
          toQuestionUpdatePayload(values, query.data!.version ?? 1),
        ),
    });
  }

  if (query.isLoading) {
    return <Spin />;
  }

  if (query.error || !query.data) {
    return (
      <EmptyState
        description="题目加载失败"
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  }

  return (
    <div>
      <PageHeader title="编辑题目" />
      <Card>
        {query.data.status === 'disabled' && (
          <Alert
            type="warning"
            showIcon
            message="题目已停用：可继续编辑，启用后才会出现在组卷候选中"
            style={{ marginBottom: 16 }}
          />
        )}
        <QuestionForm
          key={query.data.version}
          mode="edit"
          initialValues={toQuestionFormValues(query.data)}
          submitting={updateMutation.isPending}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/admin/questions')}
        />
      </Card>
      <Modal
        title="内容已在其他页面被修改，请刷新后重试"
        open={conflictOpen}
        okText="刷新"
        cancelText="关闭"
        okButtonProps={{ autoInsertSpace: false }}
        cancelButtonProps={{ autoInsertSpace: false }}
        onOk={refreshAfterConflict}
        onCancel={() => setConflictOpen(false)}
      >
        刷新将载入最新数据，本次未保存的修改会丢失。
      </Modal>
    </div>
  );
}
