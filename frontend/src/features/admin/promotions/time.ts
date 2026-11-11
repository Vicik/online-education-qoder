import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

// 本模块独立启用插件：测试与运行时都可直接使用
dayjs.extend(utc);
dayjs.extend(timezone);

// 服务端 ISO → DatePicker 值：以上海时区钟面展示
export function toPickerValue(iso: string): Dayjs {
  return dayjs.utc(iso).tz('Asia/Shanghai');
}

// DatePicker 值 → 服务端 ISO：钟面时间按上海时区解释，再转 UTC
export function fromPickerValue(value: Dayjs): string {
  return value.tz('Asia/Shanghai', true).utc().toISOString();
}
