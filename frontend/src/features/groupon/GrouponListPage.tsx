import { useEffect, useState } from 'react';
import { Col, Pagination, Row } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { listGroupons } from '@/api/promotion';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { usePagination } from '@/hooks/usePagination';
import { GrouponCard } from './GrouponCard';

// 拼团列表每页数量
const PAGE_SIZE = 12;

// 拼团列表：进行中活动 + 分页 + 服务端倒计时
export default function GrouponListPage() {
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 进行中活动分页查询
  const query = useQuery({
    queryKey: queryKeys.groupons(page),
    queryFn: () => listGroupons(page, pageSize),
  });

  // 同步后端总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 倒计时到期：重取一次列表，剔除已结束活动
  const handleExpire = () => {
    void query.refetch();
  };

  // 当前页活动
  const items = query.data?.items ?? [];

  return (
    <div>
      {items.length === 0 && !query.isLoading ? (
        <EmptyState description="暂无进行中的拼团活动" />
      ) : (
        <Row gutter={[16, 16]}>
          {items.map((item) => (
            <Col key={item.id} xs={24} md={12} lg={8}>
              <GrouponCard activity={item} onExpire={handleExpire} />
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
