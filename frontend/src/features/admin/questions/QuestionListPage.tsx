import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Select, Space } from 'antd';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disableQuestion,
  enableQuestion,
  listAdminQuestions,
} from '@/api/admin/questions';
import { queryKeys } from '@/api/query-keys';
import type { ApiError } from '@/api/errors';
import type {
  AdminQuestion,
  AdminQuestionStatus,
  AdminQuestionType,
} from '@/api/types';
import { AppTable } from '@/components/common/AppTable';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusTag } from '@/components/common/StatusTag';
import { usePagination } from '@/hooks/usePagination';
import { formatShanghai } from '@/lib/datetime';

// 列表每页数量
const PAGE_SIZE = 10;

// 题型筛选项
const TYPE_OPTIONS = [
  { value: 'all', label: '全部题型' },
  { value: 'single', label: '单选' },
  { value: 'multiple', label: '多选' },
];

// 状态筛选项
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已停用' },
];

// 题库列表：筛选、分页、编辑入口与启停
export default function QuestionListPage() {
  // 路由跳转
  const navigate = useNavigate();
  // AntD 消息
  const { message } = AntdApp.useApp();
  // 查询缓存
  const queryClient = useQueryClient();
  // 当前题型筛选
  const [type, setType] = useState<AdminQuestionType | 'all'>('all');
  // 当前状态筛选
  const [status, setStatus] = useState<AdminQuestionStatus | 'all'>('all');
  // 当前总数
  const [total, setTotal] = useState(0);
  // 分页
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 题目列表查询：筛选与分页共同决定缓存键
  const query = useQuery({
    queryKey: queryKeys.adminQuestions(
      `${page}:${pageSize}:${type}:${status}`,
    ),
    queryFn: () =>
      listAdminQuestions(
        page,
        pageSize,
        type === 'all' ? undefined : type,
        status === 'all' ? undefined : status,
      ),
  });

  // 同步总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 启停题目
  const toggleMutation = useMutation<AdminQuestion, ApiError, AdminQuestion>({
    mutationFn: (record) =>
      record.status === 'enabled'
        ? disableQuestion(record.id ?? 0)
        : enableQuestion(record.id ?? 0),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'questions'] });
      message.success('题目状态已更新');
    },
    onError: (error) => message.error(error.message),
  });

  // 表格列
  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 70 },
    {
      title: '题干',
      dataIndex: 'stem',
      key: 'stem',
      ellipsis: true,
      render: (stem: string, record: AdminQuestion) => (
        <Link to={`/admin/questions/${record.id}`}>{stem}</Link>
      ),
    },
    {
      title: '题型',
      dataIndex: 'type',
      key: 'type',
      width: 90,
      render: (value: AdminQuestionType) => (
        <StatusTag domain="question" status={value} />
      ),
    },
    { title: '分值', dataIndex: 'score', key: 'score', width: 80 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value: AdminQuestionStatus) => (
        <StatusTag domain="question" status={value} />
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (value: string | undefined) =>
        value ? formatShanghai(value) : '—',
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: unknown, record: AdminQuestion) => (
        <Space>
          <Link to={`/admin/questions/${record.id}`}>编辑</Link>
          <ConfirmAction
            title={record.status === 'enabled' ? '停用题目' : '启用题目'}
            content={
              record.status === 'enabled'
                ? '停用后，该题目将无法用于组卷；已发布考试的快照不受影响。'
                : '启用后，该题目会重新出现在组卷候选中。'
            }
            okText={record.status === 'enabled' ? '确认停用' : '确认启用'}
            danger={record.status === 'enabled'}
            onConfirm={async () => {
              await toggleMutation.mutateAsync(record);
            }}
          >
            <Button type="link" size="small" autoInsertSpace={false}>
              {record.status === 'enabled' ? '停用' : '启用'}
            </Button>
          </ConfirmAction>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="题库管理"
        extra={
          <Space>
            <Select
              aria-label="题型筛选"
              value={type}
              options={TYPE_OPTIONS}
              style={{ width: 130 }}
              onChange={(next) => {
                setType(next);
                onChange(1, pageSize);
              }}
            />
            <Select
              aria-label="状态筛选"
              value={status}
              options={STATUS_OPTIONS}
              style={{ width: 130 }}
              onChange={(next) => {
                setStatus(next);
                onChange(1, pageSize);
              }}
            />
            <Button
              type="primary"
              onClick={() => navigate('/admin/questions/create')}
            >
              创建题目
            </Button>
          </Space>
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
        emptyText="还没有题目"
      />
    </div>
  );
}
