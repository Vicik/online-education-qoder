import { Button, Card, Popover, Tabs, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { getCourseDetail, getRecommendations } from '@/api/catalog';
import { ApiError, getErrorAction } from '@/api/errors';
import { listMyCoupons } from '@/api/promotion';
import { queryKeys } from '@/api/query-keys';
import { listMyOrders } from '@/api/trade';
import type { CourseBrief, CourseDetail } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';
import { MoneyText } from '@/components/common/MoneyText';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { ClaimCouponButton } from '@/features/coupon/ClaimCouponButton';
import { courseTypeLabel } from '@/lib/course';
import { useSessionStore } from '@/stores/session';
import { CourseActivityBar } from './CourseActivityBar';
import { CourseChapterList } from './CourseChapterList';
import { CourseCouponList } from './CourseCouponList';
import { FavoriteButton } from './FavoriteButton';
import './CourseDetailPage.css';

// 详情页主按钮：游客与未购用户先购买，已购用户进入学习
function resolveCourseCta(courseId: number, purchased = false): { label: string; to: string } {
  if (purchased) return { label: '立即学习', to: `/learning/${courseId}` };
  return { label: '立即购买', to: `/checkout/${courseId}` };
}

// 精品推荐项：左侧封面 + 右侧名称与价格
function SideCourseCard({ course }: { course: CourseBrief }) {
  // 封面是否加载失败
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <Link to={`/courses/${course.id}`} className="course-detail-side-item">
      <div className="course-detail-side-cover">
        {course.coverUrl && !coverFailed && (
          <img
            src={course.coverUrl}
            alt={course.name ?? '课程封面'}
            onError={() => setCoverFailed(true)}
          />
        )}
      </div>
      <div className="course-detail-side-info">
        <span className="course-detail-side-name">{course.name}</span>
        <MoneyText cents={course.saleCents ?? 0} originalCents={course.originalCents} />
      </div>
    </Link>
  );
}

// 课程详情页：顶部信息卡 + 列表/详情页签 + 精品推荐
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
  // 精品推荐：与首页共享缓存
  const recommendations = useQuery({
    queryKey: queryKeys.homeRecommendations,
    queryFn: getRecommendations,
  });
  // 购买记录：登录后用于判断当前课程是否已购
  const ordersQuery = useQuery({
    queryKey: queryKeys.myOrdersAll,
    queryFn: () => listMyOrders(1, 100),
    enabled: Boolean(user),
    retry: false,
  });
  // 我的领取记录：登录后判断券是否已领取（含全部状态）
  const claimsQuery = useQuery({
    queryKey: queryKeys.myCoupons('all', 1),
    queryFn: () => listMyCoupons(undefined, 1, 100),
    enabled: Boolean(user),
    retry: false,
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
  // 是否已购买：存在该课程的已支付订单
  const purchased = Boolean(
    ordersQuery.data?.items.some(
      (order) => order.courseId === detailId && order.status === 'paid',
    ),
  );
  // 主按钮文案与目标
  const cta = resolveCourseCta(detailId, purchased);
  // 可领优惠券
  const coupons = course.claimableCoupons ?? [];
  // 已领取的模板 id：invalid 记录不占用限领额度
  const claimedTemplateIds = new Set(
    (claimsQuery.data?.items ?? []).flatMap((item) =>
      item.status !== 'invalid' && item.templateId !== undefined ? [item.templateId] : [],
    ),
  );
  // 课程类型中文名
  const typeLabel = courseTypeLabel(course.type);
  // 是否免费课程
  const isFree = (course.saleCents ?? 0) === 0;
  // 推荐位：排除当前课程，最多三条
  const recommendItems = (recommendations.data ?? [])
    .filter((item) => item.id !== detailId)
    .slice(0, 3);

  return (
    <div className="course-detail">
      <div className="course-detail-hero">
        <div className="course-detail-cover">
          {course.coverUrl ? (
            <img
              src={course.coverUrl}
              alt={course.name ?? '课程封面'}
              onError={() => query.refetch()}
            />
          ) : (
            <div className="course-detail-cover-placeholder" />
          )}
        </div>
        <div className="course-detail-info">
          <div className="course-detail-heading">
            <h1 className="course-detail-title">{course.name}</h1>
            {user && <FavoriteButton courseId={detailId} />}
          </div>
          <p className="course-detail-meta">
            {typeLabel && <span>【{typeLabel}】</span>}
            <span>讲师：{course.instructor ?? '—'}</span>
          </p>
          <div className="course-detail-price">
            <MoneyText
              cents={course.saleCents ?? 0}
              originalCents={course.originalCents}
              size="large"
            />
            {isFree && <span className="course-detail-free">免费</span>}
          </div>
          {coupons.length > 0 && (
            <Popover
              trigger="click"
              placement="bottomLeft"
              overlayClassName="course-coupon-popover"
              content={
                <CourseCouponList
                  coupons={coupons}
                  courseName={course.name ?? ''}
                  claimedIds={claimedTemplateIds}
                  renderAction={(coupon) => {
                    // 模板 id 缺失时不渲染操作
                    const couponId = coupon.id;
                    if (couponId === undefined) return null;
                    // 登录用户等待领取记录，避免先出现「领取」再跳变
                    if (user && claimsQuery.isPending) return null;
                    return (
                      <ClaimCouponButton
                        coupon={coupon}
                        courseId={detailId}
                        claimed={claimedTemplateIds.has(couponId)}
                      />
                    );
                  }}
                />
              }
            >
              <button type="button" className="course-detail-coupon">
                领取优惠券
              </button>
            </Popover>
          )}
          <div className="course-detail-actions">
            <Button
              type="primary"
              size="large"
              className="course-detail-cta"
              onClick={() => navigate(cta.to)}
            >
              {cta.label}
            </Button>
          </div>
        </div>
      </div>

      <CourseActivityBar groupon={course.groupon ?? null} flashSale={course.flashSale ?? null} />

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
                    {course.intro && <Typography.Paragraph>{course.intro}</Typography.Paragraph>}
                    {course.detailRich && <RichTextViewer html={course.detailRich} />}
                    {!course.intro && !course.detailRich && (
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
        {recommendItems.length > 0 && (
          <aside className="course-detail-side">
            <h2 className="course-detail-side-title">精品推荐</h2>
            <div className="course-detail-side-list">
              {recommendItems.map((item) => (
                <SideCourseCard key={item.id} course={item} />
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
