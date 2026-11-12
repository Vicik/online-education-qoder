import { Typography } from 'antd';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/api/query-keys';
import { getRecommendations, listCourses } from '@/api/catalog';
import { CourseGrid, CourseGridSkeleton } from '@/features/catalog/CourseGrid';
import { EmptyState } from '@/components/common/EmptyState';

// 首页最新课程展示数量
const LATEST_SIZE = 8;

// 首页：推荐 + 最新，两块独立请求，互不阻塞
export default function HomePage() {
  // 推荐课程
  const recommendations = useQuery({
    queryKey: queryKeys.homeRecommendations,
    queryFn: getRecommendations,
  });
  // 最新课程（独立键，避免与课程列表页共享分页缓存）
  const latest = useQuery({
    queryKey: queryKeys.homeLatest,
    queryFn: () => listCourses({ page: 1, pageSize: LATEST_SIZE }),
  });

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        推荐课程
      </Typography.Title>
      {recommendations.isLoading ? (
        <CourseGridSkeleton />
      ) : recommendations.data && recommendations.data.length > 0 ? (
        <CourseGrid courses={recommendations.data} onCoverError={() => recommendations.refetch()} />
      ) : (
        <EmptyState description="暂无推荐课程" />
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 32,
          // 与推荐课程标题的默认下边距对齐，保证标题到课程网格的间距一致
          marginBottom: 10,
        }}
      >
        <Typography.Title level={4} style={{ margin: 0 }}>
          最新课程
        </Typography.Title>
        {latest.data && latest.data.items.length > 0 && (
          <Link to="/courses">查看全部</Link>
        )}
      </div>
      {latest.isLoading ? (
        <CourseGridSkeleton />
      ) : latest.data && latest.data.items.length > 0 ? (
        <CourseGrid courses={latest.data.items} onCoverError={() => latest.refetch()} />
      ) : (
        <EmptyState description="暂无课程" />
      )}
    </div>
  );
}
