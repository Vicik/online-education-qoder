import { useState } from 'react';
import { Alert, App as AntdApp, Button, Card, Modal, Spin } from 'antd';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdminExam, updateExam } from '@/api/admin/exams';
import { queryKeys } from '@/api/query-keys';
import type { ApiError } from '@/api/errors';
import type { AdminExamDetail, ExamUpdateInput } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { ExamForm } from './ExamForm';
import {
  toExamFormValues,
  toExamUpdatePayload,
  type ExamFormValues,
} from './payload';

// 考试详情：草稿可编辑，已发布/已结束只读
export default function ExamEditPage() {
  // 路由参数
  const params = useParams();
  // 考试 id
  const examId = Number(params.id);
  // 返回列表
  const navigate = useNavigate();
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 查询缓存
  const queryClient = useQueryClient();
  // 版本冲突弹窗开关
  const [conflictOpen, setConflictOpen] = useState(false);

  // 考试详情
  const query = useQuery({
    queryKey: queryKeys.adminExam(examId),
    queryFn: () => getAdminExam(examId),
    enabled: Number.isInteger(examId) && examId > 0,
  });

  // 版本冲突：刷新详情
  function showConflict() {
    setConflictOpen(true);
  }

  // 刷新详情并关闭冲突弹窗
  function refreshAfterConflict() {
    setConflictOpen(false);
    void query.refetch();
  }

  // 保存草稿：携带 version
  const updateMutation = useMutation<
    AdminExamDetail,
    ApiError,
    ExamUpdateInput
  >({
    mutationFn: (input) => updateExam(examId, input),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.adminExam(examId), updated);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'exams'] });
      message.success('考试已保存');
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
  function handleSubmit(values: ExamFormValues) {
    modal.confirm({
      title: '保存考试',
      content: '保存后草稿内容立即更新，确认保存？',
      okText: '确认保存',
      cancelText: '取消',
      cancelButtonProps: { autoInsertSpace: false },
      onOk: async () => {
        try {
          await updateMutation.mutateAsync(
            toExamUpdatePayload(values, query.data!.version ?? 1),
          );
        } catch {
          // 错误已由 onError 提示（409 弹出刷新弹窗）
        }
      },
    });
  }

  if (query.isLoading) {
    return <Spin />;
  }

  if (query.error || !query.data) {
    return (
      <EmptyState
        description="考试加载失败"
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  }

  // 只读与提示文案
  const readOnly = query.data.status !== 'draft';
  // 状态提示
  const alert =
    query.data.status === 'published'
      ? '考试已发布，题目已冻结，不可编辑'
      : query.data.status === 'ended'
        ? '考试已结束，不可编辑'
        : null;

  return (
    <div>
      <PageHeader title="考试详情" />
      <Card>
        {alert && (
          <Alert
            type="info"
            showIcon
            message={alert}
            style={{ marginBottom: 16 }}
          />
        )}
        <ExamForm
          key={query.data.version}
          mode="edit"
          initialValues={toExamFormValues(query.data)}
          readOnly={readOnly}
          submitting={updateMutation.isPending}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/admin/exams')}
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
