import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { serverNow } from '@/lib/server-clock';

// 本模块独立启用插件：测试与运行时都可直接使用
dayjs.extend(utc);
dayjs.extend(timezone);

// DatePicker 禁用时分秒的回调集合（结构对齐 AntD disabledTime）
export interface DisabledTimeConfig {
  disabledHours?: () => number[]; // 禁用小时
  disabledMinutes?: (hour: number) => number[]; // 禁用分钟
  disabledSeconds?: (hour: number, minute: number) => number[]; // 禁用秒
}

// 0 到 max-1 的整数序列：表示某时刻之前（含）可禁用的单位
function rangeBefore(max: number): number[] {
  return Array.from({ length: Math.max(0, max) }, (_, index) => index);
}

// 选择器使用的当前时刻：按上海时区与校正后的服务端时钟取值
function pickerNow(): Dayjs {
  return dayjs.utc(serverNow()).tz('Asia/Shanghai');
}

// 服务端 ISO → DatePicker 值：以上海时区钟面展示
export function toPickerValue(iso: string): Dayjs {
  return dayjs.utc(iso).tz('Asia/Shanghai');
}

// DatePicker 值 → 服务端 ISO：钟面时间按上海时区解释，再转 UTC
export function fromPickerValue(value: Dayjs): string {
  return value.tz('Asia/Shanghai', true).utc().toISOString();
}

// 禁用当前日期之前的日期（当天可选，具体时刻由 disabledPastTime 限制）
export function disabledPastDate(
  current: Dayjs,
  now: Dayjs = pickerNow(),
): boolean {
  return current.isBefore(now, 'day');
}

// 禁用当天早于当前时刻的小时/分钟/秒
export function disabledPastTime(
  current: Dayjs | null,
  now: Dayjs = pickerNow(),
): DisabledTimeConfig {
  if (!current || !current.isSame(now, 'day')) return {};
  return {
    disabledHours: () => rangeBefore(now.hour()),
    disabledMinutes: (hour) =>
      hour === now.hour() ? rangeBefore(now.minute()) : [],
    disabledSeconds: (hour, minute) =>
      hour === now.hour() && minute === now.minute()
        ? rangeBefore(now.second())
        : [],
  };
}
