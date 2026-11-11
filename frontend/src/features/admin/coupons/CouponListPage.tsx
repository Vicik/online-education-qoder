import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Select, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  disableCouponTemplate,
  enableCouponTemplate,
  listAdminCoupons,
} from '@/api/admin/coupons';
import type { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { AdminCouponTemplate, CouponTemplateStatus } from '@/api/types';
import { AppTable } from '@/components/common/AppTable';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { MoneyText } from '@/components/common/MoneyText';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusTag } from '@/components/common/StatusTag';
import { formatShanghai } from '@/lib/datetime';
import { usePagination } from '@/hooks/usePagination';
import { CouponFormModal } from './CouponFormModal';

// 列表每页数量
const PAGE_SIZE = 10;

// 状态筛选项：all 表示不传 status
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'enabled', label: '已启用' },
  { value: 'disabled', label: '已停用' },
];

// 优惠券管理：状态筛选、列表、创建、启停
export default function CouponListPage() {
  // 查询客户端
  const queryClient = useQueryClient();
  // AntD 消息与确认框
  const { modal, message } = AntdApp.useApp();
  // 当前状态筛选
  const [status, setStatus] = useState<CouponTemplateStatus | 'all'>('all');
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);
  // 创建弹窗开关
  const [createOpen, setCreateOpen] = useState(false);

  // 模板列表查询：状态与分页共同决定缓存键
  const query = useQuery({
    queryKey: queryKeys.adminCoupons(page, status),
    queryFn: () =>
      listAdminCoupons(page, pageSize, status === 'all' ? undefined : status),
  });

  // 同步后端总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 统一刷新优惠券列表与详情
  function refreshCoupons() {
    return queryClient.invalidateQueries({ queryKey: ['admin', 'coupons'] });
  }

  // 409 刷新弹窗：只重取列表，不覆盖他人修改
  function showConflict() {
    modal.confirm({
      title: '内容已在其他页面被修改',
      content: '请刷新后重试，系统不会自动覆盖他人修改。',
      okText: '刷新',
      cancelText: '取消',
      // 两个汉字的按钮不自动插空格，保持与 ConfirmAction 一致
      okButtonProps: { autoInsertSpace: false },
      cancelButtonProps: { autoInsertSpace: false },
      onOk: async () => {
        await refreshCoupons();
      },
    });
  }

  // 启用模板：仅停用态
  const enableMutation = useMutation<AdminCouponTemplate, ApiError, number>({
    mutationFn: enableCouponTemplate,
    onSuccess: async () => {
      await refreshCoupons();
      message.success('优惠券已启用');
    },
    onError: (error) => {
      if (error.status === 409) {
        showConflict();
        return;
      }
      message.error(error.message);
    },
  });

  // 停用模板：级联失效由服务端执行
  const disableMutation = useMutation<AdminCouponTemplate, ApiError, number>({
    mutationFn: disableCouponTemplate,
    onSuccess: async () => {
      await refreshCoupons();
      message.success('优惠券已停用');
    },
    onError: (error) => {
      if (error.status === 409) {
        showConflict();
        return;
      }
      message.error(error.message);
    },
  });

  // 切换状态并回到第一页
  function handleStatusChange(next: CouponTemplateStatus | 'all') {
    setStatus(next);
    onChange(1, pageSize);
  }

  // 表格列
  const columns: ColumnsType<AdminCouponTemplate> = [
    {
      title: '券名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: AdminCouponTemplate) => (
        <Link to={`/admin/coupons/${record.id ?? 0}`}>{name}</Link>
      ),
    },
    {
      title: '面额',
      dataIndex: 'discountCents',
      key: 'discountCents',
      render: (value: number) => <MoneyText cents={value} />,
    },
    {
      title: '有效期',
      key: 'period',
      render: (_: unknown, record: AdminCouponTemplate) =>
        `${formatShanghai(record.startAt ?? '')} ~ ${formatShanghai(record.endAt ?? '')}`,
    },
    {
      title: '已领 / 总量',
      key: 'quantity',
      render: (_: unknown, record: AdminCouponTemplate) =>
        `${record.claimedCount ?? 0} / ${record.totalQty ?? 0}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: AdminCouponTemplate['status']) => (
        <StatusTag domain="coupon" status={value ?? ''} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: AdminCouponTemplate) => (
        <Space>
          <Link to={`/admin/coupons/${record.id ?? 0}`}>编辑</Link>
          {record.status === 'disabled' ? (
            <ConfirmAction
              title="启用优惠券"
              content={`确认启用「${record.name}」？启用后用户即可领取。`}
              okText="确认启用"
              onConfirm={async () => {
                await enableMutation.mutateAsync(record.id ?? 0);
              }}
            >
              <Button type="link">启用</Button>
            </ConfirmAction>
          ) : (
            <ConfirmAction
              title="停用优惠券"
              content="停用后，未使用和已恢复的优惠券将永久失效且不可恢复，确认继续？"
              okText="确认停用"
              danger
              onConfirm={async () => {
                await disableMutation.mutateAsync(record.id ?? 0);
              }}
            >
              <Button type="link" danger>
                停用
              </Button>
            </ConfirmAction>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="优惠券"
        extra={
          <Space>
            <Select
              aria-label="状态筛选"
              value={status}
              options={STATUS_OPTIONS}
              style={{ width: 140 }}
              onChange={handleStatusChange}
            />
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              创建优惠券
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
        emptyText="还没有优惠券模板"
      />
      <CouponFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
