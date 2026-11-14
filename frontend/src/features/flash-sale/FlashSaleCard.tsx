import type { FlashSaleActivityBrief } from '@/api/types';
import { ActivityCardFrame } from '@/features/promotion/ActivityCardFrame';
import { deriveActivityStatus } from '@/lib/activity-status';

// 秒杀页脚底色：与参考图一致的橙色
const FLASH_SALE_FOOTER_COLOR = '#fa8c16';

// 秒杀活动卡片：课程封面 + 课程标题 + 秒杀价 + 橙色状态页脚与倒计时
export function FlashSaleCard({
  activity,
  onExpire,
}: {
  activity: FlashSaleActivityBrief;
  onExpire?: () => void;
}) {
  // 活动 id：整卡跳秒杀详情
  const activityId = activity.id ?? 0;
  // 展示状态：按服务端时间推导，避免物化状态滞后
  const status = deriveActivityStatus(activity);
  // 是否未开始：倒计时到开始时间，其余到活动结束时间
  const notStarted = status === 'not_started';
  // 是否已售罄：以服务端剩余库存为准
  const soldOut = (activity.remaining ?? 0) <= 0;
  // 倒计时截止时间
  const deadlineAt = (notStarted ? activity.startAt : activity.endAt) ?? '';
  // 页脚状态文案：售罄优先
  const footerLabel = soldOut
    ? '已售罄'
    : notStarted
      ? '即将开始'
      : status === 'ongoing'
        ? '秒杀中'
        : '已结束';

  return (
    <ActivityCardFrame
      to={`/flash-sales/${activityId}`}
      courseName={activity.courseName ?? ''}
      coverUrl={activity.courseCoverUrl ?? null}
      priceCents={activity.priceCents ?? 0}
      originalCents={activity.courseOriginalCents}
      footerColor={FLASH_SALE_FOOTER_COLOR}
      footerLabel={footerLabel}
      deadlineAt={deadlineAt}
      onExpire={onExpire}
    />
  );
}
