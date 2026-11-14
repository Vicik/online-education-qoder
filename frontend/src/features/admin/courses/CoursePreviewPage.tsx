import { Alert, Card, Tabs, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { getAdminCourse } from '@/api/admin/courses';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { MoneyText } from '@/components/common/MoneyText';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { CourseChapterList } from '@/features/catalog/CourseChapterList';
import { courseTypeLabel } from '@/lib/course';
import '@/features/catalog/CourseDetailPage.css';
import './CoursePreviewPage.css';

// 管理端课程预览：沿用详情页视觉，去掉精品推荐与全部购买互动
export default function CoursePreviewPage() {
  // 路由参数：课程 id
  const { id: rawId } = useParams();
  // 解析后的课程 id
  const courseId = Number(rawId);
  // id 合法才发起请求
  const validId = Number.isInteger(courseId) && courseId > 0;
  // 封面加载失败：仅本页降级为占位
  const [coverFailed, setCoverFailed] = useState(false);

  // 课程详情：走管理端接口，草稿与已下架也可预览
  const query = useQuery({
    queryKey: queryKeys.adminCourse(courseId),
    queryFn: () => getAdminCourse(courseId),
    enabled: validId,
  });
  // 非法的路由 id
  if (!validId) {
    return (
      <EmptyState
        description="课程不存在"
        action={<Link to="/admin/courses">返回课程列表</Link>}
      />
    );
  }

  // 课程不存在或请求失败
  if (query.error) {
    return (
      <EmptyState
        description={query.error.message}
        action={<Link to="/admin/courses">返回课程列表</Link>}
      />
    );
  }

  // 加载中
  if (query.isLoading || !query.data) {
    return <Card loading />;
  }

  // 已加载的课程详情
  const course = query.data;
  // 展示价：普通课程售价，不含秒杀/拼团活动价
  const displayPriceCents = course.saleCents ?? 0;
  // 课程类型中文名
  const typeLabel = courseTypeLabel(course.type);
  // 是否免费课程
  const isFree = (course.saleCents ?? 0) === 0;

  return (
    <div className="course-detail">
      <Alert
        type="info"
        showIcon
        className="course-detail-preview-tip"
        message="预览模式：仅展示课程内容，购买、优惠券、收藏与拼团操作已隐藏"
      />
      <div className="course-detail-hero">
        <div className="course-detail-cover">
          {course.coverUrl && !coverFailed ? (
            <img
              src={course.coverUrl}
              alt={course.name ?? '课程封面'}
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <div className="course-detail-cover-placeholder" />
          )}
        </div>
        <div className="course-detail-info">
          <div className="course-detail-heading">
            <h1 className="course-detail-title">{course.name}</h1>
          </div>
          <p className="course-detail-meta">
            {typeLabel && <span>【{typeLabel}】</span>}
            <span>讲师：{course.instructor ?? '—'}</span>
          </p>
          <div className="course-detail-price">
            <MoneyText
              cents={displayPriceCents}
              originalCents={course.originalCents}
              size="large"
            />
            {isFree && displayPriceCents === 0 && (
              <span className="course-detail-free">免费</span>
            )}
          </div>
          {course.intro && (
            <Typography.Paragraph className="course-preview-summary">
              {course.intro}
            </Typography.Paragraph>
          )}
        </div>
      </div>

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
                    {course.detailRich ? (
                      <RichTextViewer html={course.detailRich} />
                    ) : (
                      <Typography.Text type="secondary">暂无介绍</Typography.Text>
                    )}
                  </div>
                ),
              },
              {
                key: 'chapters',
                label: '章节目录',
                children: <CourseChapterList chapters={course.chapters ?? []} />,
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
