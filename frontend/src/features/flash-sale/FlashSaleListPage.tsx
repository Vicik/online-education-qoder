import { useEffect, useState } from 'react';
import { Col, Pagination, Row } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { listFlashSales } from '@/api/promotion';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { usePagination } from '@/hooks/usePagination';
import { FlashSaleCard } from './FlashSaleCard';

// 秒杀列表每页数量
const PAGE_SIZE = 12;

// 秒杀列表：未开始与进行中活动 + 分页 + 倒计时
export default function FlashSaleListPage() {
  // 后端返回的活动总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 活动分页查询
  const query = useQuery({
    queryKey: queryKeys.flashSales(page),
    queryFn: () => listFlashSales(page, pageSize),
  });

  // 同步后端总数：分页组件按总数计算页数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 倒计时到期：重取列表，刷新未开始/已结束展示
  const handleExpire = () => {
    void query.refetch();
  };

  // 当前页活动
  const items = query.data?.items ?? [];

  return (
    <div>
      {items.length === 0 && !query.isLoading ? (
        <EmptyState description="暂无秒杀活动" />
      ) : (
        <Row gutter={[16, 16]}>
          {items.map((item) => (
            <Col key={item.id} xs={24} md={12} lg={8}>
              <FlashSaleCard activity={item} onExpire={handleExpire} />
            </Col>
          ))}
        </Row>
      )}
      {total > 0 && (
        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          onChange={onChange}
          style={{ marginTop: 16, textAlign: 'right' }}
        />
      )}
    </div>
  );
}
