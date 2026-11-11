import type { Dayjs } from 'dayjs';
import type { GrouponCreateInput, GrouponUpdateInput } from '@/api/types';
import { fromPickerValue } from '../promotions/time';

// 拼团表单值：课程 id + 价格 + 人数 + 起止时间
export interface GrouponFormValues {
  courseId: number;
  name: string;
  priceCents: number | null;
  targetSize: number;
  startAt: Dayjs;
  endAt: Dayjs;
}

// 创建载荷：课程可写
export function toGrouponCreatePayload(
  values: GrouponFormValues,
): GrouponCreateInput {
  return {
    courseId: values.courseId,
    name: values.name.trim(),
    priceCents: values.priceCents ?? 0,
    targetSize: values.targetSize,
    startAt: fromPickerValue(values.startAt),
    endAt: fromPickerValue(values.endAt),
  };
}

// 编辑载荷：courseId 不在开放编辑范围，version 必带
export function toGrouponUpdatePayload(
  values: GrouponFormValues,
  version: number,
): GrouponUpdateInput {
  return {
    version,
    name: values.name.trim(),
    priceCents: values.priceCents ?? 0,
    targetSize: values.targetSize,
    startAt: fromPickerValue(values.startAt),
    endAt: fromPickerValue(values.endAt),
  };
}
