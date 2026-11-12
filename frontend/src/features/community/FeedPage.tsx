import { useEffect, useState } from 'react';
import { Button, Pagination } from 'antd';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listPosts } from '@/api/community';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PostCard } from './PostCard';

// 信息流每页数量
const PAGE_SIZE = 10;

// 社区信息流：分页、发帖入口、游客登录回跳
export default function FeedPage() {
  // 当前用户
  const { user } = usePermission();
  // 路由跳转
  const navigate = useNavigate();
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

  // 发帖入口：游客先登录
  const gotoNewPost = () => {
    if (!user) {
      navigate('/login?redirect=%2Fcommunity%2Fnew');
      return;
    }
    navigate('/community/new');
  };

  // 当前页帖子
  const items = query.data?.items ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" onClick={gotoNewPost}>
          发布帖子
        </Button>
      </div>
      {items.length === 0 && !query.isLoading ? (
        <EmptyState description="还没有帖子，来发第一帖吧" />
      ) : (
        items.map((item) => <PostCard key={item.id} post={item} />)
      )}
      {total > 0 && (
        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          onChange={onChange}
          style={{ textAlign: 'right' }}
        />
      )}
    </div>
  );
}
