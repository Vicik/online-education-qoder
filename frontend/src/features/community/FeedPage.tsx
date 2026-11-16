import { useEffect, useState } from 'react';
import { Pagination } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { listPosts } from '@/api/community';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { usePagination } from '@/hooks/usePagination';
import { CommunitySidebar } from './CommunitySidebar';
import { PostCard } from './PostCard';
import './FeedPage.css';

// 信息流每页数量
const PAGE_SIZE = 10;

// 社区信息流：左侧帖子流 + 右侧发布入口与精品推荐
export default function FeedPage() {
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 信息流查询
  const query = useQuery({
    queryKey: queryKeys.posts(page),
    queryFn: () => listPosts(page, pageSize),
  });

  // 同步后端总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 当前页帖子
  const items = query.data?.items ?? [];

  return (
    <div className="community-page">
      <div className="community-main">
        {items.length === 0 && !query.isLoading ? (
          <EmptyState description="还没有帖子，来发第一帖吧" />
        ) : (
          <div className="community-feed">
            {items.map((item) => (
              <PostCard key={item.id} post={item} />
            ))}
          </div>
        )}
        {total > 0 && (
          <div className="community-pagination">
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              onChange={onChange}
            />
          </div>
        )}
      </div>
      <CommunitySidebar />
    </div>
  );
}
