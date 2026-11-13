import { Pagination } from 'antd';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { listCourses } from '@/api/catalog';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { usePagination } from '@/hooks/usePagination';
import { CourseGrid, CourseGridSkeleton } from './CourseGrid';

// 列表页每页数量：网格 3–4 列，12 条适配 1200px 容器
const PAGE_SIZE = 12;

// 已发布课程列表：仅分页，后端无搜索/筛选参数
export default function CourseListPage() {
  // 课程总数（首屏 0，响应后回填分页组件）
  const [total, setTotal] = useState(0);
  // 分页状态：total 变化时越界自动回退
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);
  // 当前页课程
  const query = useQuery({
    queryKey: queryKeys.courses(page),
    queryFn: () => listCourses({ page, pageSize }),
    placeholderData: keepPreviousData,
  });

  // 响应总数同步给分页组件
  useEffect(() => {
    setTotal(query.data?.total ?? 0);
  }, [query.data?.total]);

  return (
    <div>
      {query.isError ? (
        <EmptyState
          description={query.error?.message ?? '加载失败'}
          action={<a onClick={() => query.refetch()}>重试</a>}
        />
      ) : query.isLoading ? (
        <CourseGridSkeleton />
      ) : query.data && query.data.items.length > 0 ? (
        <>
          <CourseGrid courses={query.data.items} />
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
        <EmptyState description="暂无课程" />
      )}
    </div>
  );
}
