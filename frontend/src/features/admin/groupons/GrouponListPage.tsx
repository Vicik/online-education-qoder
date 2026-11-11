import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelGroupon, listAdminGroupons } from '@/api/admin/groupons';
import type { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { AdminGroupon } from '@/api/types';
import { AppTable } from '@/components/common/AppTable';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { MoneyText } from '@/components/common/MoneyText';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusTag } from '@/components/common/StatusTag';
import { formatShanghai } from '@/lib/datetime';
import { usePagination } from '@/hooks/usePagination';
import { GrouponFormDrawer } from './GrouponFormDrawer';

// 列表每页数量
const PAGE_SIZE = 10;

// 拼团管理：列表、抽屉创建/编辑、取消
export default function GrouponListPage() {
  // 查询客户端
  const queryClient = useQueryClient();
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);
  // 抽屉开关
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 正在编辑的活动（空表示创建）
  const [editing, setEditing] = useState<AdminGroupon | null>(null);

  // 活动列表查询
  const query = useQuery({
    queryKey: queryKeys.adminGroupons(page),
    queryFn: () => listAdminGroupons(page, pageSize),
  });

  // 同步后端总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 409 刷新弹窗：只重取列表，不覆盖他人修改
  function showConflict(onRefresh?: () => void) {
    modal.confirm({
      title: '内容已在其他页面被修改',
      content: '请刷新后重试，系统不会自动覆盖他人修改。',
      okText: '刷新',
      cancelText: '取消',
      // 两个汉字的按钮不自动插空格，保持与 ConfirmAction 一致
      okButtonProps: { autoInsertSpace: false },
      cancelButtonProps: { autoInsertSpace: false },
      onOk: async () => {
        await queryClient.invalidateQueries({ queryKey: ['admin', 'groupons'] });
        onRefresh?.();
      },
    });
  }

  // 取消活动：仅未开始；并发状态变化由服务端校验
  const cancelMutation = useMutation<AdminGroupon, ApiError, number>({
    mutationFn: cancelGroupon,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'groupons'] });
      message.success('活动已取消');
    },
    onError: (error) => {
      if (error.status === 409) {
        showConflict();
        return;
      }
      message.error(error.message);
    },
  });

  // 打开创建抽屉
  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }

  // 打开编辑抽屉
  function openEdit(activity: AdminGroupon) {
    setEditing(activity);
    setDrawerOpen(true);
  }

  // 关闭抽屉并清空编辑对象
  function closeDrawer() {
    setDrawerOpen(false);
    setEditing(null);
  }

  // 表格列
  const columns: ColumnsType<AdminGroupon> = [
    { title: '活动名称', dataIndex: 'name', key: 'name' },
    { title: '课程', dataIndex: 'courseName', key: 'courseName' },
    {
      title: '拼团价',
      dataIndex: 'priceCents',
      key: 'priceCents',
      render: (value: number) => <MoneyText cents={value} />,
    },
    { title: '成团人数', dataIndex: 'targetSize', key: 'targetSize' },
    {
      title: '活动时间',
      key: 'period',
      render: (_: unknown, record: AdminGroupon) =>
        `${formatShanghai(record.startAt ?? '')} ~ ${formatShanghai(record.endAt ?? '')}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: AdminGroupon['status']) => (
        <StatusTag domain="groupon" status={value ?? ''} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: AdminGroupon) => {
        // 仅未开始可编辑/取消
        const editable = record.status === 'not_started';
        return (
          <Space>
            <Button
              type="link"
              disabled={!editable}
              onClick={() => openEdit(record)}
            >
              编辑
            </Button>
            <ConfirmAction
              title="取消拼团活动"
              content={`确认取消「${record.name}」？取消后不可恢复。`}
              okText="确认取消"
              danger
              disabled={!editable}
              onConfirm={async () => {
                await cancelMutation.mutateAsync(record.id ?? 0);
              }}
            >
              <Button type="link" danger disabled={!editable}>
                取消
              </Button>
            </ConfirmAction>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="拼团管理"
        extra={
          <Button type="primary" onClick={openCreate}>
            创建拼团
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
        emptyText="还没有拼团活动"
      />
      <GrouponFormDrawer
        open={drawerOpen}
        activity={editing}
        onClose={closeDrawer}
        onSaved={closeDrawer}
        onConflict={() => {
          closeDrawer();
          showConflict();
        }}
      />
    </div>
  );
}
