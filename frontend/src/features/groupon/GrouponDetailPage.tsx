import { useNavigate, useParams } from 'react-router';
import { App as AntdApp, Avatar, Button, Card } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCourseDetail } from '@/api/catalog';
import type { ApiError } from '@/api/errors';
import {
  createGrouponGroup,
  getGroupon,
  joinGrouponGroup,
} from '@/api/promotion';
import { queryKeys } from '@/api/query-keys';
import type { GrouponGroup, Order } from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { EmptyState } from '@/components/common/EmptyState';
import { ActivityDetailBody } from '@/features/promotion/ActivityDetailBody';
import { ActivityDetailHero } from '@/features/promotion/ActivityDetailHero';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useCountdown } from '@/hooks/useCountdown';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { usePermission } from '@/hooks/usePermission';
import { deriveActivityStatus } from '@/lib/activity-status';
import { courseTypeLabel } from '@/lib/course';
import './GrouponDetailPage.css';

// 开团/参团的返回结构
interface GrouponOrderResult {
  order: Order; // 待支付订单
  group: GrouponGroup; // 团组信息
}

// 团组截止倒计时：剩余「X天 HH:mm:ss」，到期回调刷新团组
function GroupCountdown({
  deadlineAt,
  onExpire,
}: {
  deadlineAt: string;
  onExpire?: () => void;
}) {
  // 剩余毫秒：基于服务端校准时间
  const remainingMs = useCountdown(deadlineAt, onExpire);
  // 总秒数（不为负）
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  // 天数（两位）
  const days = String(Math.floor(totalSeconds / 86400)).padStart(2, '0');
  // 小时（两位）
  const hours = String(Math.floor((totalSeconds % 86400) / 3600)).padStart(2, '0');
  // 分钟（两位）
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  // 秒（两位）
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return (
    <span className="groupon-groups-deadline">
      剩余 {days}天 {hours}:{minutes}:{seconds}
    </span>
  );
}

// 拼团详情：课程详情式布局 + 拼团红条倒计时、待成团团组自动滚动、开团/参团
export default function GrouponDetailPage() {
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

  // 活动详情（含待成团团组）
  const query = useQuery({
    queryKey: queryKeys.groupon(activityId),
    queryFn: () => getGroupon(activityId),
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
  // 待成团团组：加载前按空数组处理，保证自动滚动钩子先于提前返回调用
  const groups = query.data?.groups ?? [];
  // 团组容器自动滚动：有团组时逐像素往返，悬停或聚焦暂停
  const groupScroll = useAutoScroll<HTMLDivElement>(groups.length > 0);

  // 失败提示并按错误码刷新详情
  const handleError = (error: ApiError) => {
    // 已参与（409 + 5001）
    if (error.status === 409 && error.code === 5001) {
      message.warning('您已参与过该拼团活动');
    } else if (error.code === 5002) {
      // 活动未开始或已结束
      message.warning('拼团活动未开始或已结束');
    } else if (error.code === 5001) {
      // 团满（422 + 5001）
      message.warning('该团已满或已结束');
    } else if (error.code === 4004) {
      // 幂等冲突：上一次请求仍在处理
      message.warning('请求正在处理中，请稍后重试');
    } else {
      message.error(error.message);
    }
    void query.refetch();
  };

  // 开团/参团共用幂等提交；groupId 为 null 表示开团
  const mutation = useIdempotentMutation<
    GrouponOrderResult,
    { groupId: number | null }
  >(
    (vars, key) =>
      vars.groupId === null
        ? createGrouponGroup(activityId, key)
        : joinGrouponGroup(activityId, vars.groupId, key),
    {
      onSuccess: ({ order }) => {
        // 团组与活动数据已变化，失效详情与列表
        void queryClient.invalidateQueries({ queryKey: queryKeys.groupon(activityId) });
        void queryClient.invalidateQueries({ queryKey: ['groupons'] });
        // 进入既有订单支付模式
        navigate(`/checkout/${order.courseId}?orderId=${order.id}`);
      },
      onError: handleError,
    },
  );

  // 游客：跳登录并回跳详情
  const gotoLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(`/groupons/${activityId}`)}`);
  };

  if (query.isLoading) return <Card loading />;
  if (query.error || !query.data) {
    return (
      <EmptyState
        description="拼团活动不存在"
        action={<Button onClick={() => navigate('/groupons')}>返回拼团列表</Button>}
      />
    );
  }

  // 活动详情
  const detail = query.data;
  // 关联课程详情：缺省时页面仍可用活动字段展示
  const course = courseQuery.data;
  // 展示状态：按服务端时间推导，物化状态滞后时仍能正确禁用参与
  const status = deriveActivityStatus(detail);
  // 是否可参与（仅进行中可参与）
  const joinable = status === 'ongoing';
  // 拼团价（分）
  const priceCents = detail.priceCents ?? 0;
  // 成团人数
  const targetSize = detail.targetSize ?? 0;
  // 倒计时截止时间：未开始到开始时间，其余到结束时间
  const deadlineAt = (status === 'not_started' ? detail.startAt : detail.endAt) ?? '';

  return (
    <div className="course-detail">
      <ActivityDetailHero
        courseId={courseId}
        coverUrl={detail.courseCoverUrl ?? course?.coverUrl ?? null}
        title={course?.name ?? detail.courseName ?? ''}
        typeLabel={courseTypeLabel(course?.type)}
        instructor={course?.instructor}
        showFavorite={Boolean(user)}
        bannerText={`${targetSize}人拼团`}
        deadlineAt={deadlineAt}
        onExpire={() => void query.refetch()}
        priceCents={priceCents}
        originalCents={course?.originalCents ?? detail.courseOriginalCents}
      >
        {!joinable ? (
          <Button type="primary" size="large" className="course-detail-cta" disabled>
            {status === 'not_started' ? '未开始' : '已结束'}
          </Button>
        ) : user ? (
          <ConfirmAction
            title="发起拼团"
            content="发起拼团会创建待支付订单，支付成功后会计入成团人数。确认继续？"
            onConfirm={async () => {
              try {
                await mutation.mutateAsync({ groupId: null });
              } catch {
                // 错误已由 onError 提示
              }
            }}
          >
            <Button
              type="primary"
              size="large"
              className="course-detail-cta"
              loading={mutation.isPending}
            >
              立即拼团
            </Button>
          </ConfirmAction>
        ) : (
          <Button
            type="primary"
            size="large"
            className="course-detail-cta"
            onClick={gotoLogin}
          >
            立即拼团
          </Button>
        )}
      </ActivityDetailHero>

      <div className="groupon-groups">
        <div className="groupon-groups-header">
          {groups.length > 0
            ? `${groups.length}人在拼单,可直接参与`
            : '暂无进行中的拼团'}
        </div>
        {groups.length > 0 ? (
          <div
            className="groupon-groups-scroll"
            ref={groupScroll.ref}
            onMouseEnter={groupScroll.onMouseEnter}
            onMouseLeave={groupScroll.onMouseLeave}
            onFocus={groupScroll.onFocus}
            onBlur={groupScroll.onBlur}
          >
            {groups.map((group) => {
              // 已支付成员数
              const memberCount = group.memberCount ?? 0;
              // 团组成团人数：缺失时回退活动配置
              const groupTargetSize = group.targetSize ?? targetSize;
              // 还差人数（不为负）
              const need = Math.max(0, groupTargetSize - memberCount);
              // 团是否已满
              const full = need === 0;
              // 去拼团按钮是否禁用
              const disabled = !joinable || full || group.status !== 'pending';
              // 团长昵称：缺失时兜底
              const leader = group.leaderNickname ?? '团长';
              return (
                <div
                  className="groupon-groups-row"
                  key={group.id ?? `${leader}-${group.expiresAt ?? ''}`}
                >
                  <Avatar className="groupon-groups-avatar" size={32}>
                    {leader.slice(0, 1)}
                  </Avatar>
                  <span className="groupon-groups-leader">{leader}</span>
                  <span className="groupon-groups-need">
                    {full ? '已满员' : `还差 ${need}人 拼成`}
                  </span>
                  <GroupCountdown
                    deadlineAt={group.expiresAt ?? ''}
                    onExpire={() => void query.refetch()}
                  />
                  {user ? (
                    <ConfirmAction
                      title="参与拼团"
                      content={`确认加入 ${leader} 的团？还差 ${need} 人成团。`}
                      onConfirm={async () => {
                        try {
                          await mutation.mutateAsync({ groupId: group.id ?? 0 });
                        } catch {
                          // 错误已由 onError 提示
                        }
                      }}
                    >
                      <Button
                        type="primary"
                        size="small"
                        className="groupon-groups-join"
                        disabled={disabled}
                        loading={mutation.isPending}
                        autoInsertSpace={false}
                      >
                        去拼团
                      </Button>
                    </ConfirmAction>
                  ) : (
                    <Button
                      type="primary"
                      size="small"
                      className="groupon-groups-join"
                      disabled={disabled}
                      onClick={gotoLogin}
                      autoInsertSpace={false}
                    >
                      去拼团
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="groupon-groups-empty">
            暂无可加入的团，点击上方「立即拼团」发起新团。
          </p>
        )}
      </div>

      <ActivityDetailBody course={course} />
    </div>
  );
}
