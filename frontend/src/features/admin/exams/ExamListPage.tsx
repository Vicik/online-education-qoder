import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Space } from 'antd';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  endExam,
  listAdminExams,
  publishExam,
} from '@/api/admin/exams';
import { queryKeys } from '@/api/query-keys';
import type { ApiError } from '@/api/errors';
import type { AdminExam, AdminExamDetail, AdminExamStatus } from '@/api/types';
import { AppTable } from '@/components/common/AppTable';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusTag } from '@/components/common/StatusTag';
import { usePagination } from '@/hooks/usePagination';
import { formatShanghai } from '@/lib/datetime';

// 列表每页数量
const PAGE_SIZE = 10;

// 考试列表：组卷入口、发布与结束
export default function ExamListPage() {
  // 路由跳转
  const navigate = useNavigate();
  // AntD 消息
  const { message } = AntdApp.useApp();
  // 查询缓存
  const queryClient = useQueryClient();
  // 当前总数
  const [total, setTotal] = useState(0);
  // 分页
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 考试列表查询
  const query = useQuery({
    queryKey: queryKeys.adminExams(page),
    queryFn: () => listAdminExams(page, pageSize),
  });

  // 同步总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 刷新列表
  async function refreshList() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'exams'] });
  }

  // 发布考试
  const publishMutation = useMutation<AdminExamDetail, ApiError, number>({
    mutationFn: (examId) => publishExam(examId),
    onSuccess: async () => {
      await refreshList();
      message.success('考试已发布');
    },
    onError: (error) => message.error(error.message),
  });

  // 结束考试
  const endMutation = useMutation<AdminExamDetail, ApiError, number>({
    mutationFn: (examId) => endExam(examId),
    onSuccess: async () => {
      await refreshList();
      message.success('考试已结束');
    },
    onError: (error) => message.error(error.message),
  });

  // 表格列
  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 70 },
    {
      title: '考试名称',
      dataIndex: 'title',
      key: 'title',
      render: (title: string, record: AdminExam) => (
        <Link to={`/admin/exams/${record.id ?? 0}`}>{title}</Link>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value: AdminExamStatus) => (
        <StatusTag domain="exam" status={value} />
      ),
    },
    { title: '总分', dataIndex: 'totalScore', key: 'totalScore', width: 80 },
    { title: '及格分', dataIndex: 'passScore', key: 'passScore', width: 90 },
    {
      title: '时长（分钟）',
      dataIndex: 'durationMin',
      key: 'durationMin',
      width: 110,
    },
    { title: '题目数', dataIndex: 'questionCount', key: 'questionCount', width: 90 },
    {
      title: '发布时间',
      dataIndex: 'publishedAt',
      key: 'publishedAt',
      width: 180,
      render: (value: string | null) =>
        value ? formatShanghai(value) : '—',
    },
    {
      title: '操作',
      key: 'actions',
      width: 190,
      render: (_: unknown, record: AdminExam) => (
        <Space>
          {record.status === 'draft' ? (
            <>
              <Link to={`/admin/exams/${record.id ?? 0}`}>编辑</Link>
              <ConfirmAction
                title="发布考试"
                content="发布后将冻结题目快照，之后不可修改，确认发布？"
                okText="确认发布"
                onConfirm={async () => {
                  await publishMutation.mutateAsync(record.id ?? 0);
                }}
              >
                <Button type="link" size="small" autoInsertSpace={false}>
                  发布
                </Button>
              </ConfirmAction>
            </>
          ) : (
            <>
              <Link to={`/admin/exams/${record.id ?? 0}`}>查看</Link>
              {record.status === 'published' && (
                <ConfirmAction
                  title="结束考试"
                  content="结束后用户将无法再参加，确认结束？"
                  okText="确认结束"
                  danger
                  onConfirm={async () => {
                    await endMutation.mutateAsync(record.id ?? 0);
                  }}
                >
                  <Button type="link" size="small" danger autoInsertSpace={false}>
                    结束
                  </Button>
                </ConfirmAction>
              )}
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="考试管理"
        extra={
          <Button
            type="primary"
            onClick={() => navigate('/admin/exams/create')}
          >
            创建考试
          </Button>
        }
      />
      <AppTable
        columns={columns}
        dataSource={query.data?.items ?? []}
        rowKey="id"
        total={total}
        page={page}
        pageSize={pageSize}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        onPageChange={onChange}
        emptyText="还没有考试"
      />
    </div>
  );
}
