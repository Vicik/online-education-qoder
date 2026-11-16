import { useEffect, useState } from 'react';
import { Button, Pagination, Skeleton, message } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deletePost, listMyPosts } from '@/api/community';
import { queryKeys } from '@/api/query-keys';
import type { ApiError } from '@/api/errors';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { EmptyState } from '@/components/common/EmptyState';
import { usePagination } from '@/hooks/usePagination';
import { PostCard } from './PostCard';
import './FeedPage.css';
import './MyPostsPage.css';

// 我的帖子每页数量
const PAGE_SIZE = 10;

// 我的帖子：仅本人发布，卡片流与信息流一致，可查看详情与删除
export default function MyPostsPage() {
  // 查询缓存
  const queryClient = useQueryClient();
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 我的帖子查询
  const query = useQuery({
    queryKey: queryKeys.myPosts(page),
    queryFn: () => listMyPosts(page, pageSize),
  });

  // 同步后端总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 删除帖子
  const handleDelete = async (postId: number) => {
    try {
      await deletePost(postId);
      message.success('已删除');
      void queryClient.invalidateQueries({ queryKey: ['user', 'posts'] });
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
    } catch (error) {
      message.error((error as ApiError).message);
    }
  };

  // 当前页帖子
  const items = query.data?.items ?? [];

  // 加载中：保留卡片占位，避免闪现空状态
  if (query.isLoading) {
    return (
      <div className="community-main">
        <Skeleton active paragraph={{ rows: 4 }} />
      </div>
    );
  }

  // 加载失败：展示错误与重试
  if (query.error) {
    return (
      <div className="community-main">
        <EmptyState
          description={(query.error as ApiError).message}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      </div>
    );
  }

  return (
    <div className="community-main">
      {items.length === 0 ? (
        <EmptyState description="还没有发布过帖子" />
      ) : (
        <div className="community-feed">
          {items.map((item) => (
            <PostCard
              key={item.id}
              post={item}
              footerExtra={
                <ConfirmAction
                  title="删除帖子"
                  content="删除后帖子与全部评论不可恢复，确认删除？"
                  danger
                  onConfirm={() => handleDelete(item.id ?? 0)}
                >
                  <Button
                    type="primary"
                    danger
                    autoInsertSpace={false}
                    className="my-post-delete"
                  >
                    删除
                  </Button>
                </ConfirmAction>
              }
            />
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
  );
}
