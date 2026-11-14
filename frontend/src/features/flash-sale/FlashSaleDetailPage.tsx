import { useNavigate, useParams } from 'react-router';
import { App as AntdApp, Button, Card } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCourseDetail } from '@/api/catalog';
import type { ApiError } from '@/api/errors';
import { getFlashSale, purchaseFlashSale } from '@/api/promotion';
import { queryKeys } from '@/api/query-keys';
import type { Order } from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { EmptyState } from '@/components/common/EmptyState';
import { ActivityDetailBody } from '@/features/promotion/ActivityDetailBody';
import { ActivityDetailHero } from '@/features/promotion/ActivityDetailHero';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { usePermission } from '@/hooks/usePermission';
import { deriveActivityStatus } from '@/lib/activity-status';
import { courseTypeLabel } from '@/lib/course';

// 秒杀详情：课程详情式布局 + 已抢/剩余红条、倒计时、售罄/未开始禁用与幂等抢购
export default function FlashSaleDetailPage() {
  // 路由参数
  const params = useParams();
  // 活动 id
  const activityId = Number(params.id);
  // 路由跳转
  const navigate = useNavigate();
  // 查询缓存
  const queryClient = useQueryClient();
  // 当前用户
  const { user } = usePermission();
  // AntD 消息提示（静态 message 无法消费 App 上下文）
  const { message } = AntdApp.useApp();

  // 活动详情
  const query = useQuery({
    queryKey: queryKeys.flashSale(activityId),
    queryFn: () => getFlashSale(activityId),
    enabled: Number.isInteger(activityId) && activityId > 0,
  });
  // 关联课程 id：活动加载后再请求课程详情
  const courseId = query.data?.courseId ?? 0;
  // 课程详情：用于封面、类型、讲师与详情页签
  const courseQuery = useQuery({
    queryKey: queryKeys.course(courseId),
    queryFn: () => getCourseDetail(courseId),
    enabled: courseId > 0,
  });

  // 失败提示并按错误码刷新库存/状态
  const handleError = (error: ApiError) => {
    // 售罄（422 + 4001）
    if (error.code === 4001) {
      message.warning('已售罄');
    } else if (error.code === 5002) {
      // 未开始或已结束
      message.warning('秒杀活动未开始或已结束');
    } else if (error.code === 5003) {
      // 一人一活动限购一次
      message.warning('同一活动限购一次');
    } else {
      message.error(error.message);
    }
    void query.refetch();
  };

  // 抢购：一次用户意图一个幂等键
  const mutation = useIdempotentMutation<{ order: Order }, void>(
    (_vars, key) => purchaseFlashSale(activityId, key),
    {
      onSuccess: ({ order }) => {
        // 库存已变化，失效详情与列表
        void queryClient.invalidateQueries({ queryKey: queryKeys.flashSale(activityId) });
        void queryClient.invalidateQueries({ queryKey: ['flash-sales'] });
        // 进入既有订单支付模式
        navigate(`/checkout/${order.courseId}?orderId=${order.id}`);
      },
      onError: handleError,
    },
  );

  // 游客：跳登录并回跳详情
  const gotoLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(`/flash-sales/${activityId}`)}`);
  };

  if (query.isLoading) return <Card loading />;
  if (query.error || !query.data) {
    return (
      <EmptyState
        description="秒杀活动不存在"
        action={<Button onClick={() => navigate('/flash-sales')}>返回秒杀列表</Button>}
      />
    );
  }

  // 活动详情
  const sale = query.data;
  // 关联课程详情：缺省时页面仍可用活动字段展示
  const course = courseQuery.data;
  // 展示状态：按服务端时间推导，物化状态滞后时仍能正确禁用抢购
  const status = deriveActivityStatus(sale);
  // 是否未开始：未开始倒计时到开始时间，其余倒计时到结束时间
  const notStarted = status === 'not_started';
  // 服务端剩余库存
  const remaining = sale.remaining ?? 0;
  // 是否售罄：以服务端剩余库存为准
  const soldOut = remaining <= 0;
  // 是否可抢购：进行中且未售罄
  const purchasable = status === 'ongoing' && !soldOut;
  // 按钮文案：售罄优先，其次未开始/已结束
  const buttonLabel = soldOut
    ? '已售罄'
    : notStarted
      ? '未开始'
      : status !== 'ongoing'
        ? '已结束'
        : '立即秒杀';
  // 倒计时截止时间
  const deadlineAt = (notStarted ? sale.startAt : sale.endAt) ?? '';

  return (
    <div className="course-detail">
      <ActivityDetailHero
        courseId={courseId}
        coverUrl={sale.courseCoverUrl ?? course?.coverUrl ?? null}
        title={course?.name ?? sale.courseName ?? ''}
        typeLabel={courseTypeLabel(course?.type)}
        instructor={course?.instructor}
        showFavorite={Boolean(user)}
        bannerText={`${sale.sold ?? 0}人已抢/剩${remaining}名`}
        deadlineAt={deadlineAt}
        onExpire={() => void query.refetch()}
        priceCents={sale.priceCents ?? 0}
        originalCents={course?.originalCents ?? sale.courseOriginalCents}
      >
        {!purchasable ? (
          <Button type="primary" size="large" className="course-detail-cta" disabled>
            {buttonLabel}
          </Button>
        ) : user ? (
          <ConfirmAction
            title="确认抢购"
            content="抢购会创建待支付订单，请在支付结果页完成支付。确认继续？"
            onConfirm={async () => {
              try {
                await mutation.mutateAsync();
              } catch {
                // 错误已由 onError 提示
              }
            }}
          >
            <Button type="primary" size="large" className="course-detail-cta" loading={mutation.isPending}>
              立即秒杀
            </Button>
          </ConfirmAction>
        ) : (
          <Button type="primary" size="large" className="course-detail-cta" onClick={gotoLogin}>
            立即秒杀
          </Button>
        )}
      </ActivityDetailHero>

      <ActivityDetailBody course={course} />
    </div>
  );
}
