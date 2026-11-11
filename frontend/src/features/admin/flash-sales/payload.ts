import type { Dayjs } from 'dayjs';
import type { FlashSaleCreateInput, FlashSaleUpdateInput } from '@/api/types';
import { fromPickerValue } from '../promotions/time';

// 秒杀表单值：课程 id + 价格 + 库存 + 起止时间
export interface FlashSaleFormValues {
  courseId: number;
  name: string;
  priceCents: number | null;
  stock: number;
  startAt: Dayjs;
  endAt: Dayjs;
}

// 创建载荷：课程可写
export function toFlashSaleCreatePayload(
  values: FlashSaleFormValues,
): FlashSaleCreateInput {
  return {
    courseId: values.courseId,
    name: values.name.trim(),
    priceCents: values.priceCents ?? 0,
    stock: values.stock,
    startAt: fromPickerValue(values.startAt),
    endAt: fromPickerValue(values.endAt),
  };
}

// 编辑载荷：courseId 不可改，version 必带
export function toFlashSaleUpdatePayload(
  values: FlashSaleFormValues,
  version: number,
): FlashSaleUpdateInput {
  return {
    version,
    name: values.name.trim(),
    priceCents: values.priceCents ?? 0,
    stock: values.stock,
    startAt: fromPickerValue(values.startAt),
    endAt: fromPickerValue(values.endAt),
  };
}
