import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Select, Space } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createBlockedWord,
  deleteBlockedWord,
  listBlockedWords,
  updateBlockedWord,
} from '@/api/admin/blocked-words';
import { queryKeys } from '@/api/query-keys';
import type { ApiError } from '@/api/errors';
import type {
  AdminBlockedWord,
  BlockedWordCreateInput,
  BlockedWordStatus,
  BlockedWordUpdateInput,
} from '@/api/types';
import { AppTable } from '@/components/common/AppTable';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusTag } from '@/components/common/StatusTag';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { usePagination } from '@/hooks/usePagination';
import {
  BlockedWordFormModal,
  type BlockedWordFormValues,
} from './BlockedWordFormModal';

// 列表每页数量
const PAGE_SIZE = 10;

// 状态筛选项
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已停用' },
];

// 屏蔽词列表：新增、改词、启停与删除
export default function BlockedWordListPage() {
  // AntD 消息
  const { message } = AntdApp.useApp();
  // 查询缓存
  const queryClient = useQueryClient();
  // 状态筛选
  const [status, setStatus] = useState<BlockedWordStatus | 'all'>('all');
  // 当前总数
  const [total, setTotal] = useState(0);
  // 分页
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);
  // 弹窗开关
  const [open, setOpen] = useState(false);
  // 正在编辑的词；null 表示新增
  const [editing, setEditing] = useState<AdminBlockedWord | null>(null);

  // 列表查询
  const query = useQuery({
    queryKey: queryKeys.adminBlockedWords(`${page}:${pageSize}:${status}`),
    queryFn: () =>
      listBlockedWords(
        page,
        pageSize,
        status === 'all' ? undefined : status,
      ),
  });

  // 同步总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 新增
  const createMutation = useIdempotentMutation<
    AdminBlockedWord,
    BlockedWordCreateInput
  >((payload, key) => createBlockedWord(payload, key), {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'blocked-words'] });
      message.success('屏蔽词已新增');
    },
  });

  // 改词/启停
  const updateMutation = useMutation<
    void,
    ApiError,
    { id: number; input: BlockedWordUpdateInput }
  >({
    mutationFn: ({ id, input }) => updateBlockedWord(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'blocked-words'] });
      message.success('屏蔽词已更新');
    },
    onError: (error) => message.error(error.message),
  });

  // 删除
  const deleteMutation = useMutation<void, ApiError, number>({
    mutationFn: (id) => deleteBlockedWord(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'blocked-words'] });
      message.success('屏蔽词已删除');
    },
    onError: (error) => message.error(error.message),
  });

  // 弹窗保存：错误交给弹窗行内处理
  async function save(values: BlockedWordFormValues) {
    if (editing) {
      await updateMutation.mutateAsync({
        id: editing.id ?? 0,
        input: { word: values.word, status: values.status ?? 'enabled' },
      });
    } else {
      await createMutation.mutateAsync({ word: values.word });
    }
    setOpen(false);
    setEditing(null);
  }

  // 表格列
  const columns = [
    { title: '屏蔽词', dataIndex: 'word', key: 'word' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (value: BlockedWordStatus) => (
        <StatusTag domain="question" status={value} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_: unknown, record: AdminBlockedWord) => (
        <Space>
          <Button
            type="link"
            size="small"
            autoInsertSpace={false}
            onClick={() => {
              setEditing(record);
              setOpen(true);
            }}
          >
            编辑
          </Button>
          <ConfirmAction
            title={record.status === 'enabled' ? '停用屏蔽词' : '启用屏蔽词'}
            content={
              record.status === 'enabled'
                ? '停用后，用户端将不再拦截该词；可随时重新启用。'
                : '启用后，用户端提交内容将立即按该词校验。'
            }
            okText={record.status === 'enabled' ? '确认停用' : '确认启用'}
            danger={record.status === 'enabled'}
            onConfirm={async () => {
              await updateMutation.mutateAsync({
                id: record.id ?? 0,
                input: {
                  status: record.status === 'enabled' ? 'disabled' : 'enabled',
                },
              });
            }}
          >
            <Button type="link" size="small" autoInsertSpace={false}>
              {record.status === 'enabled' ? '停用' : '启用'}
            </Button>
          </ConfirmAction>
          <ConfirmAction
            title="删除屏蔽词"
            content="删除后无法恢复，用户端将立即不再拦截该词，确认删除？"
            okText="确认删除"
            danger
            onConfirm={async () => {
              await deleteMutation.mutateAsync(record.id ?? 0);
            }}
          >
            <Button type="link" size="small" danger autoInsertSpace={false}>
              删除
            </Button>
          </ConfirmAction>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="屏蔽词管理"
        extra={
          <Space>
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
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              新增屏蔽词
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
        emptyText="还没有屏蔽词"
      />
      <BlockedWordFormModal
        open={open}
        editing={editing}
        submitting={createMutation.isPending || updateMutation.isPending}
        onCancel={() => {
          setOpen(false);
          setEditing(null);
        }}
        onSubmit={save}
      />
    </div>
  );
}
