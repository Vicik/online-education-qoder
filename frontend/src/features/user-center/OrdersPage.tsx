import { Button, Pagination, Skeleton } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { listMyOrders } from '@/api/trade';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { formatShanghai } from '@/lib/datetime';
import { formatCents } from '@/lib/money';
import { usePagination } from '@/hooks/usePagination';
import './records.css';

// 购买记录每页数量
const PAGE_SIZE = 20;

// 订单状态 → 卡片右侧文字与颜色
const ORDER_STATUS_STYLE: Record<string, { text: string; color: string }> = {
  pending: { text: '待支付', color: '#fa8c16' },
  paid: { text: '已支付', color: '#12a05c' },
  refunded: { text: '已退款', color: '#f5222d' },
  cancelled: { text: '已取消', color: '#8c8c8c' },
};

// 购买记录：仅本人订单，卡片流展示
export default function OrdersPage() {
  // 订单总数（响应后回填）
  const [total, setTotal] = useState(0);
  // 分页状态
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);
  // 订单列表
  const query = useQuery({
    queryKey: queryKeys.myOrders(page),
    queryFn: () => listMyOrders(page, pageSize),
    placeholderData: (previous) => previous,
  });

  // 响应总数同步给分页组件
  useEffect(() => {
    setTotal(query.data?.total ?? 0);
  }, [query.data?.total]);

  // 当前页订单
  const items = query.data?.items ?? [];

  // 卡片列表：加载占位、错误重试、空态与订单卡片
  let content;
  if (query.isLoading) {
    content = (
      <div className="record-list">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="record-card" active />
        ))}
      </div>
    );
  } else if (query.error) {
    content = (
      <EmptyState
        description="加载失败"
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  } else if (items.length === 0) {
    content = <EmptyState description="暂无购买记录" />;
  } else {
    content = (
      <>
        <div className="record-list">
          {items.map((order) => {
            // 实付为 0 时展示「免费」，否则保留两位小数金额
            const price =
              (order.paidCents ?? 0) === 0
                ? '免费'
                : formatCents(order.paidCents ?? 0);
            // 未命中状态映射时回退原文
            const status = ORDER_STATUS_STYLE[order.status ?? ''] ?? {
              text: order.status ?? '—',
              color: 'rgba(0, 0, 0, 0.65)',
            };

            return (
              <article key={order.id} className="record-card order-record">
                <div className="order-record-meta">
                  <span>
                    <span className="order-record-label">订单时间：</span>
                    {order.createdAt ? formatShanghai(order.createdAt) : '—'}
                  </span>
                  <span>
                    <span className="order-record-label">订单号：</span>
                    {order.orderNo}
                  </span>
                </div>
                <div className="order-record-name">{order.courseName}</div>
                <div className="order-record-bottom">
                  <span className="order-record-price">{price}</span>
                  <span
                    className="order-record-status"
                    style={{ color: status.color }}
                  >
                    {status.text}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
        {total > 0 && (
          <div className="record-pagination">
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              onChange={onChange}
            />
          </div>
        )}
      </>
    );
  }

  return (
    <div>
      <PageHeader title="购买记录" />
      {content}
    </div>
  );
}
