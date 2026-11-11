import { Button, Card, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { getCourseDetail } from '@/api/catalog';
import { ApiError, getErrorAction } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { CourseDetail } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { MoneyText } from '@/components/common/MoneyText';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { useSessionStore, type SessionUser } from '@/stores/session';
import { CourseActivityBar } from './CourseActivityBar';
import { CourseChapterList } from './CourseChapterList';
import { CourseCouponList } from './CourseCouponList';
import { FavoriteButton } from './FavoriteButton';

// 详情页主按钮：游客先登录并回跳，登录用户进入结算
export function resolveCourseCta(
  user: SessionUser | null,
  courseId: number,
): { label: string; to: string } {
  if (!user) {
    return {
      label: '立即学习',
      to: `/login?redirect=${encodeURIComponent(`/courses/${courseId}`)}`,
    };
  }
  return { label: '立即购买', to: `/checkout/${courseId}` };
}

// 课程详情页：基础信息 + 活动 + 可领券 + 富文本详情 + 章节目录
export default function CourseDetailPage() {
  // 路由参数：课程 id
  const { id: rawId } = useParams();
  // 解析后的课程 id
  const courseId = Number(rawId);
  // id 合法才发起请求
  const validId = Number.isInteger(courseId) && courseId > 0;
  // 当前会话用户
  const user = useSessionStore((state) => state.user);
  // 跳转
  const navigate = useNavigate();

  // 课程详情
  const query = useQuery({
    queryKey: queryKeys.course(courseId),
    queryFn: () => getCourseDetail(courseId),
    enabled: validId,
  });

  // 非 3001 的错误在此兜底；2001/2002 已由全局处理
  if (
    query.error &&
    getErrorAction(query.error instanceof ApiError ? query.error.code : 0) !== 'course-not-found'
  ) {
    return (
      <EmptyState
        description={query.error.message}
        action={<a onClick={() => query.refetch()}>重试</a>}
      />
    );
  }

  if (query.error || !validId) {
    return (
      <EmptyState
        description="课程不存在或已下架"
        action={<Link to="/courses">返回课程列表</Link>}
      />
    );
  }

  if (query.isLoading || !query.data) {
    return <Card loading />;
  }

  // 已加载的课程详情
  const course: CourseDetail = query.data;
  // 课程 id：详情响应缺省时回退路由参数
  const detailId = course.id ?? courseId;
  // 主按钮文案与目标
  const cta = resolveCourseCta(user, detailId);

  return (
    <div>
      <PageHeader title={course.name} />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ width: 320 }}>
            {course.coverUrl ? (
              <img
                src={course.coverUrl}
                alt={course.name ?? '课程封面'}
                style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 6 }}
                onError={() => query.refetch()}
              />
            ) : (
              <div style={{ width: '100%', height: 180, background: '#f0f2f5', borderRadius: 6 }} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 280 }}>
            <MoneyText
              cents={course.saleCents ?? 0}
              originalCents={course.originalCents}
              size="large"
            />
            <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
              讲师：{course.instructor ?? '—'}
            </Typography.Paragraph>
            <Space wrap>
              <Button type="primary" size="large" onClick={() => navigate(cta.to)}>
                {cta.label}
              </Button>
              {user && <FavoriteButton courseId={detailId} />}
              {user && <Link to={`/learning/${detailId}`}>已购买？去学习</Link>}
            </Space>
          </div>
        </div>
      </Card>

      <CourseActivityBar groupon={course.groupon ?? null} flashSale={course.flashSale ?? null} />
      <CourseCouponList coupons={course.claimableCoupons ?? []} />

      <Card title="课程介绍" style={{ marginBottom: 16 }}>
        {course.intro && <Typography.Paragraph>{course.intro}</Typography.Paragraph>}
        {course.detailRich && <RichTextViewer html={course.detailRich} />}
        {!course.intro && !course.detailRich && (
          <Typography.Text type="secondary">暂无介绍</Typography.Text>
        )}
      </Card>

      <Card title="章节目录">
        <CourseChapterList chapters={course.chapters ?? []} />
      </Card>
    </div>
  );
}
