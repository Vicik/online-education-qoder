import { useQuery } from '@tanstack/react-query';
import { Tabs, Typography } from 'antd';
import { getRecommendations } from '@/api/catalog';
import { queryKeys } from '@/api/query-keys';
import type { CourseDetail } from '@/api/types';
import { CourseMiniCard } from '@/components/common/CourseMiniCard';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { CourseChapterList } from '@/features/catalog/CourseChapterList';
import '@/features/catalog/CourseDetailPage.css';

// 活动详情正文：课程详情/章节目录页签 + 右侧精品推荐
export function ActivityDetailBody({ course }: { course?: CourseDetail }) {
  // 精品推荐：与首页共享缓存
  const recommendations = useQuery({
    queryKey: queryKeys.homeRecommendations,
    queryFn: getRecommendations,
  });
  // 推荐位：排除当前课程，最多三条
  const recommendItems = (recommendations.data ?? [])
    .filter((item) => item.id !== course?.id)
    .slice(0, 3);

  return (
    <div className="course-detail-body">
      <div className="course-detail-main">
        <Tabs
          defaultActiveKey="intro"
          className="course-detail-tabs"
          items={[
            {
              key: 'intro',
              label: '详情',
              children: (
                <div className="course-detail-intro">
                  <h2 className="course-detail-section-title">课程概述</h2>
                  {course?.intro && (
                    <Typography.Paragraph>{course.intro}</Typography.Paragraph>
                  )}
                  {course?.detailRich && <RichTextViewer html={course.detailRich} />}
                  {!course?.intro && !course?.detailRich && (
                    <Typography.Text type="secondary">暂无介绍</Typography.Text>
                  )}
                </div>
              ),
            },
            {
              key: 'chapters',
              label: '章节目录',
              children: <CourseChapterList chapters={course?.chapters ?? []} />,
            },
          ]}
        />
      </div>
      {recommendItems.length > 0 && (
        <aside className="course-detail-side">
          <h2 className="course-detail-side-title">精品推荐</h2>
          <div className="course-detail-side-list">
            {recommendItems.map((item) => (
              <CourseMiniCard key={item.id} course={item} />
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
