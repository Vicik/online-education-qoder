import type { GrouponActivityBrief } from '@/api/types';
import { ActivityCardFrame } from '@/features/promotion/ActivityCardFrame';

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
  // 课程 id：整卡跳课程详情
  const courseId = activity.courseId ?? 0;
  // 是否未开始：倒计时到开始时间，其余到活动结束时间
  const notStarted = activity.status === 'not_started';
  // 倒计时截止时间
  const deadlineAt = (notStarted ? activity.startAt : activity.endAt) ?? '';
  // 页脚状态文案
  const footerLabel = notStarted
    ? '即将开始'
    : activity.status === 'ongoing'
      ? '拼团中'
      : '已结束';

  return (
    <ActivityCardFrame
      courseId={courseId}
      source="groupon"
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
