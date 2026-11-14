import type { GrouponActivityBrief } from '@/api/types';
import { ActivityCardFrame } from '@/features/promotion/ActivityCardFrame';
import { deriveActivityStatus } from '@/lib/activity-status';

// 拼团页脚底色：橙色
const GROUPON_FOOTER_COLOR = '#fa8c16';

// 拼团活动卡片：课程封面 + 课程标题 + 拼团价 + 橙色状态页脚与倒计时
export function GrouponCard({
  activity,
  onExpire,
}: {
  activity: GrouponActivityBrief;
  onExpire?: () => void;
}) {
  // 活动 id：整卡跳拼团详情
  const activityId = activity.id ?? 0;
  // 展示状态：按服务端时间推导，避免物化状态滞后
  const status = deriveActivityStatus(activity);
  // 是否未开始：倒计时到开始时间，其余到活动结束时间
  const notStarted = status === 'not_started';
  // 倒计时截止时间
  const deadlineAt = (notStarted ? activity.startAt : activity.endAt) ?? '';
  // 页脚状态文案
  const footerLabel = notStarted
    ? '即将开始'
    : status === 'ongoing'
      ? '拼团中'
      : '已结束';

  return (
    <ActivityCardFrame
      to={`/groupons/${activityId}`}
      courseName={activity.courseName ?? ''}
      coverUrl={activity.courseCoverUrl ?? null}
      priceCents={activity.priceCents ?? 0}
      originalCents={activity.courseOriginalCents}
      footerColor={GROUPON_FOOTER_COLOR}
      footerLabel={footerLabel}
      deadlineAt={deadlineAt}
      onExpire={onExpire}
    />
  );
}
