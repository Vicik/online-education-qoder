import { Button, Pagination, Skeleton, Tabs } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { listMyCoupons, type CouponStatus } from '@/api/promotion';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { usePagination } from '@/hooks/usePagination';
import { CouponCard } from './CouponCard';
import './CouponCard.css';

// 四个状态页签：与设计框架 §8.3 一致，restored 不展示
const TABS: Array<{ key: CouponStatus; label: string }> = [
  { key: 'unused', label: '未使用' },
  { key: 'used', label: '已使用' },
  { key: 'expired', label: '已过期' },
  { key: 'invalid', label: '已失效' },
];

// 我的优惠券每页记录数
const PAGE_SIZE = 10;

// 我的优惠券页面：四状态页签 + 卡片流 + 分页
export default function MyCouponsPage() {
  // 当前状态页签
  const [status, setStatus] = useState<CouponStatus>('unused');
  // 当前状态下的总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange, reset } = usePagination(total, PAGE_SIZE);

  // 我的券分页查询
  const query = useQuery({
    queryKey: queryKeys.myCoupons(status, page),
    queryFn: () => listMyCoupons(status, page, pageSize),
  });

  // 同步后端总数到分页状态
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 切换页签：回到第一页并清空旧总数
  function handleTabChange(key: string) {
    setStatus(key as CouponStatus);
    setTotal(0);
    reset();
  }

  // 当前页记录
  const items = query.data?.items ?? [];

  // 卡片区：加载占位、错误重试、空态与券卡片
  let content;
  if (query.isLoading) {
    content = (
      <div className="coupon-grid">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="coupon-card coupon-card-skeleton">
            <Skeleton active title={false} paragraph={{ rows: 3 }} />
          </div>
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
    content = <EmptyState description="暂无优惠券" />;
  } else {
    content = (
      <>
        <div className="coupon-grid">
          {items.map((item) => (
            <CouponCard key={item.id} coupon={item} />
          ))}
        </div>
        {total > 0 && (
          <div className="coupon-pagination">
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
      <PageHeader title="我的优惠券" />
      <Tabs
        activeKey={status}
        items={TABS.map((tab) => ({ key: tab.key, label: tab.label }))}
        onChange={handleTabChange}
      />
      {content}
    </div>
  );
}
