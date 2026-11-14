import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { serverNow } from '@/lib/server-clock';

// 本模块独立启用插件：避免依赖其他模块的初始化顺序
dayjs.extend(utc);

// 活动展示状态：与后端枚举一致
export type ActivityDisplayStatus = 'not_started' | 'ongoing' | 'ended' | 'cancelled';

// 推导输入：接口返回的已存状态与起止时间（ISO 字符串）
export interface ActivityPeriodLike {
  status?: string; // 物化状态（可能滞后于真实时间）
  startAt?: string; // 开始时间（ISO UTC）
  endAt?: string; // 结束时间（ISO UTC）
}

// 时间缺失/非法时回退到已存状态，保持与后端枚举相同的兜底
function fallbackStatus(status?: string): ActivityDisplayStatus {
  return status === 'not_started' || status === 'ongoing' || status === 'cancelled'
    ? status
    : 'ended';
}

// 按服务端时间推导展示状态：取消/已结束为终态，其余由起止时间决定
export function deriveActivityStatus(
  activity: ActivityPeriodLike,
  nowMs: number = serverNow(),
): ActivityDisplayStatus {
  // 已取消不随时间恢复
  if (activity.status === 'cancelled') return 'cancelled';
  // 已结束为终态，避免时钟回拨或改期把历史活动重新展示为进行中
  if (activity.status === 'ended') return 'ended';
  // 起止时间缺失时无法推导，回退已存状态
  if (!activity.startAt || !activity.endAt) return fallbackStatus(activity.status);

  // 起止时间毫秒值
  const startMs = dayjs.utc(activity.startAt).valueOf();
  // 结束时间毫秒值
  const endMs = dayjs.utc(activity.endAt).valueOf();
  // 非法时间同样回退已存状态
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return fallbackStatus(activity.status);

  // 未到开始时间
  if (nowMs < startMs) return 'not_started';
  // 已过结束时间（与后端 Worker 判定一致：endAt 早于 now）
  if (nowMs > endMs) return 'ended';
  // 处于活动时间区间内
  return 'ongoing';
}
