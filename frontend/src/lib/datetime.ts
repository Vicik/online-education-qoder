import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

// 注册 UTC 与时区插件：运行时的导入点自行保证插件可用，不依赖测试环境
dayjs.extend(utc);
dayjs.extend(timezone);

// 服务端 ISO 时间 → Asia/Shanghai 展示（分钟精度）
export function formatShanghai(iso: string): string {
  return dayjs.utc(iso).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm');
}

// 剩余毫秒 → HH:mm:ss
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

// 以服务端时间判断是否到期
export function isPast(iso: string, nowMs: number): boolean {
  return dayjs.utc(iso).valueOf() <= nowMs;
}
