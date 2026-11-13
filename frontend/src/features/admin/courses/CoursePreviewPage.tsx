import { Alert, Avatar, Card, Tabs, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { getAdminCourse } from '@/api/admin/courses';
import { queryKeys } from '@/api/query-keys';
import { Countdown } from '@/components/common/Countdown';
import { EmptyState } from '@/components/common/EmptyState';
import { MoneyText } from '@/components/common/MoneyText';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { CourseChapterList } from '@/features/catalog/CourseChapterList';
import { useCoursePromotion } from '@/features/catalog/useCoursePromotion';
import { ActivityCountdown } from '@/features/promotion/ActivityCardFrame';
import { useAutoScroll } from '@/hooks/useAutoScroll';
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
  // 秒杀/拼团展示数据：只渲染横幅与团组，不提供下单入口
  const promotion = useCoursePromotion({
    courseId,
    groupon: query.data?.groupon ?? null,
    flashSale: query.data?.flashSale ?? null,
  });
  // 拼团团组自动滚动：悬停或聚焦暂停
  const groupScroll = useAutoScroll<HTMLDivElement>(promotion.groups.length > 0);

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
  // 活动价：秒杀优先，其次拼团；无活动时沿用课程售价
  const activityPriceCents = course.flashSale?.priceCents ?? course.groupon?.priceCents;
  // 实际展示价
  const displayPriceCents = activityPriceCents ?? course.saleCents ?? 0;
  // 课程类型中文名
  const typeLabel = courseTypeLabel(course.type);
  // 是否免费课程
  const isFree = (course.saleCents ?? 0) === 0;
  // 待成团团组
  const groups = promotion.groups;

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
          {promotion.banner && (
            <div className="course-promo-banner">
              <span>{promotion.banner.text}</span>
              <ActivityCountdown
                deadlineAt={promotion.banner.deadlineAt}
                onExpire={() => void query.refetch()}
              />
            </div>
          )}
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

      {promotion.banner?.kind === 'groupon' && (
        <Card
          className="course-groupon-groups"
          title={
            groups.length > 0
              ? `${groups.length} 个团正在拼单，可直接参与`
              : '正在拼单'
          }
        >
          {promotion.groupsLoading ? (
            <Typography.Text type="secondary">加载中…</Typography.Text>
          ) : groups.length === 0 ? (
            <Typography.Text type="secondary">
              暂无可加入的团，点击上方「立即拼团」发起新团。
            </Typography.Text>
          ) : (
            // 团组纵向滚动：团多时自动滚动，悬停/聚焦暂停
            <div
              className="course-groupon-scroll"
              ref={groupScroll.ref}
              onMouseEnter={groupScroll.onMouseEnter}
              onMouseLeave={groupScroll.onMouseLeave}
              onFocus={groupScroll.onFocus}
              onBlur={groupScroll.onBlur}
            >
              {groups.map((group) => {
                // 已支付成员数
                const memberCount = group.memberCount ?? 0;
                // 成团人数
                const targetSize = group.targetSize ?? 0;
                // 还差人数
                const needCount = Math.max(targetSize - memberCount, 0);
                return (
                  <div className="course-groupon-row" key={group.id}>
                    <Avatar className="course-groupon-avatar">
                      {group.leaderNickname?.slice(0, 1) || '团'}
                    </Avatar>
                    <span className="course-groupon-nickname">
                      {group.leaderNickname || '拼团用户'}
                    </span>
                    <span className="course-groupon-remaining">
                      还差 <b>{needCount}</b> 人拼成
                    </span>
                    <Countdown
                      deadlineAt={group.expiresAt ?? ''}
                      prefix="剩余"
                      onExpire={() => void query.refetch()}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

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
