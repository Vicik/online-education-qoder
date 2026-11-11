import { List, Tabs } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { listMyCoupons, type CouponStatus } from '@/api/promotion';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { usePagination } from '@/hooks/usePagination';
import { CouponCard } from './CouponCard';

// 四个状态页签：与设计框架 §8.3 一致，restored 不展示
const TABS: Array<{ key: CouponStatus; label: string }> = [
  { key: 'unused', label: '未使用' },
  { key: 'used', label: '已使用' },
  { key: 'expired', label: '已过期' },
  { key: 'invalid', label: '已失效' },
];

// 我的优惠券每页记录数
const PAGE_SIZE = 10;

// 我的优惠券页面：四状态页签 + 分页
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

  return (
    <div>
      <PageHeader title="我的优惠券" />
      <Tabs
        activeKey={status}
        items={TABS.map((tab) => ({ key: tab.key, label: tab.label }))}
        onChange={handleTabChange}
      />
      {items.length === 0 && !query.isLoading ? (
        <EmptyState description="暂无优惠券" />
      ) : (
        <List
          loading={query.isLoading}
          dataSource={items}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange,
          }}
          renderItem={(item) => <CouponCard coupon={item} />}
        />
      )}
    </div>
  );
}
