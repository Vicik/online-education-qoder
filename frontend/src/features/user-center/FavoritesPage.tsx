import { Button, Pagination, Skeleton } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { listFavorites, removeFavorite } from '@/api/catalog';
import { queryKeys } from '@/api/query-keys';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { usePagination } from '@/hooks/usePagination';
import './records.css';

// 收藏页每页数量
const PAGE_SIZE = 12;

// 课程类型 → 行内标签文案
const TYPE_LABELS: Record<'video' | 'audio', string> = {
  video: '视频',
  audio: '音频',
};

// 封面缩略图：无地址或加载失败时回退灰块，只有本行降级
function FavoriteCover({ url, alt }: { url: string | null; alt: string }) {
  // 本行是否已回退占位
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div
        className="favorite-row-cover favorite-row-cover-empty"
        aria-label="课程封面占位"
      />
    );
  }

  return (
    <img
      className="favorite-row-cover"
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

// 我的收藏：行列表展示，查看课程详情或取消收藏
export default function FavoritesPage() {
  // 跳转课程详情
  const navigate = useNavigate();
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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.favoritesRoot }),
  });

  // 响应总数同步给分页组件
  useEffect(() => {
    setTotal(query.data?.total ?? 0);
  }, [query.data?.total]);

  // 当前页收藏
  const items = query.data?.items ?? [];

  // 行列表：加载占位、错误重试、空态与收藏行
  let content;
  if (query.isLoading) {
    content = (
      <div className="record-list">
        {[0, 1, 2, 3].map((key) => (
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
    content = (
      <EmptyState
        description="暂无收藏"
        action={<a href="/courses">去逛逛</a>}
      />
    );
  } else {
    content = (
      <>
        <div className="record-list">
          {items.map((course) => (
            <article key={course.id} className="record-card favorite-row">
              <span className="favorite-row-type">
                {course.type ? TYPE_LABELS[course.type] : '课程'}
              </span>
              <FavoriteCover
                url={course.coverUrl ?? null}
                alt={course.name ?? '课程封面'}
              />
              <span className="favorite-row-name" title={course.name}>
                {course.name}
              </span>
              <div className="favorite-row-actions">
                <Button
                  type="primary"
                  className="favorite-row-view"
                  autoInsertSpace={false}
                  onClick={() => navigate(`/courses/${course.id}`)}
                >
                  查看
                </Button>
                <ConfirmAction
                  title="取消收藏该课程？"
                  danger
                  onConfirm={() => remove.mutateAsync(course.id ?? 0)}
                  disabled={remove.isPending}
                >
                  <Button className="favorite-row-remove" autoInsertSpace={false}>
                    删除
                  </Button>
                </ConfirmAction>
              </div>
            </article>
          ))}
        </div>
        {total > 0 && (
          <div className="record-pagination">
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger={false}
              onChange={onChange}
            />
          </div>
        )}
      </>
    );
  }

  return (
    <div>
      <PageHeader title="我的收藏" />
      {content}
    </div>
  );
}
