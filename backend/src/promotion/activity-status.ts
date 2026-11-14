// 活动展示状态：拼团与秒杀两个枚举取值一致，展示层按时间推导
export type ActivityDisplayStatus =
  'not_started' | 'ongoing' | 'ended' | 'cancelled';

// 推导输入：数据库中已存的状态与活动起止时间
export interface ActivityPeriod {
  status: ActivityDisplayStatus; // 物化状态（可能被 Worker 滞后更新）
  startAt: Date; // 开始时间
  endAt: Date; // 结束时间
}

// 按时间推导展示状态：取消为终态；其余以起止时间为准，避免 Worker 停摆时展示失真
export function deriveActivityStatus(
  activity: ActivityPeriod,
  now: Date,
): ActivityDisplayStatus {
  // 已取消不随时间恢复
  if (activity.status === 'cancelled') return 'cancelled';
  // 已结束为终态，避免时钟回拨或改期把历史活动重新展示为进行中
  if (activity.status === 'ended') return 'ended';
  // 未到开始时间
  if (now.getTime() < activity.startAt.getTime()) return 'not_started';
  // 已过结束时间（与 Worker 判定一致：endAt 早于 now）
  if (now.getTime() > activity.endAt.getTime()) return 'ended';
  // 处于活动时间区间内
  return 'ongoing';
}
