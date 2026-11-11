import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { listMyOrders } from '@/api/trade';
import { queryKeys } from '@/api/query-keys';
import type { Order } from '@/api/types';
import { AppTable } from '@/components/common/AppTable';
import { MoneyText } from '@/components/common/MoneyText';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusTag } from '@/components/common/StatusTag';
import { formatShanghai } from '@/lib/datetime';
import { usePagination } from '@/hooks/usePagination';

// 购买记录每页数量
const PAGE_SIZE = 20;

// 购买记录：仅本人订单
export default function OrdersPage() {
  // 订单总数（响应后回填）
  const [total, setTotal] = useState(0);
  // 分页状态
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);
  // 订单列表
  const query = useQuery({
    queryKey: queryKeys.myOrders(page),
    queryFn: () => listMyOrders(page, pageSize),
  });

  // 响应总数同步给分页组件
  useEffect(() => {
    setTotal(query.data?.total ?? 0);
  }, [query.data?.total]);

  return (
    <div>
      <PageHeader title="购买记录" />
      <AppTable<Order>
        rowKey="id"
        dataSource={query.data?.items ?? []}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={onChange}
        emptyText="暂无购买记录"
        columns={[
          { title: '订单号', dataIndex: 'orderNo', width: 200 },
          { title: '课程', dataIndex: 'courseName' },
          {
            title: '实付',
            dataIndex: 'paidCents',
            width: 120,
            render: (value: number) => <MoneyText cents={value} />,
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (value: string) => <StatusTag domain="order" status={value} />,
          },
          {
            title: '购买时间',
            dataIndex: 'createdAt',
            width: 180,
            render: (value: string) => formatShanghai(value),
          },
        ]}
      />
    </div>
  );
}
