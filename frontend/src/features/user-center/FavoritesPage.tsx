import { Button, Pagination } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { listFavorites, removeFavorite } from '@/api/catalog';
import { queryKeys } from '@/api/query-keys';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { usePagination } from '@/hooks/usePagination';
import { CourseGridSkeleton } from '@/features/catalog/CourseGrid';
import { CourseCard } from '@/features/catalog/CourseCard';

// 收藏页每页数量
const PAGE_SIZE = 12;

// 我的收藏：仅课程，取消收藏需二次确认
export default function FavoritesPage() {
  // QueryClient：删除后失效收藏缓存
  const queryClient = useQueryClient();
  // 收藏总数（首屏 0，响应后回填）
  const [total, setTotal] = useState(0);
  // 分页状态
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);
  // 当前页收藏
  const query = useQuery({
    queryKey: queryKeys.favorites(page),
    queryFn: () => listFavorites(page, PAGE_SIZE),
    placeholderData: (previous) => previous,
  });
  // 汇总取消收藏
  const remove = useMutation({
    mutationFn: removeFavorite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.favoritesRoot }),
  });

  // 响应总数同步给分页组件
  useEffect(() => {
    setTotal(query.data?.total ?? 0);
  }, [query.data?.total]);

  return (
    <div>
      <PageHeader title="我的收藏" />
      {query.isLoading ? (
        <CourseGridSkeleton count={3} />
      ) : query.data && query.data.items.length > 0 ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            {query.data.items.map((course) => (
              <CourseCard
                key={course.id}
                course={course}
                footer={
                  <ConfirmAction
                    title="取消收藏该课程？"
                    danger
                    onConfirm={() => remove.mutateAsync(course.id ?? 0)}
                    disabled={remove.isPending}
                  >
                    <Button danger block style={{ marginTop: 8 }}>
                      取消收藏
                    </Button>
                  </ConfirmAction>
                }
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger={false}
              onChange={onChange}
            />
          </div>
        </>
      ) : (
        <EmptyState description="暂无收藏" action={<a href="/courses">去逛逛</a>} />
      )}
    </div>
  );
}
