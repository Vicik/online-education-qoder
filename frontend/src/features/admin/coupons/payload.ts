import type { Dayjs } from 'dayjs';
import type {
  AdminCouponTemplate,
  CouponTemplateCreateInput,
  CouponTemplateUpdateInput,
} from '@/api/types';
import { fromPickerValue, toPickerValue } from '../promotions/time';

// 优惠券表单值：面额 + 有效期 + 总量 + 适用课程
export interface CouponFormValues {
  name: string;
  discountCents: number | null;
  startAt: Dayjs;
  endAt: Dayjs;
  totalQty: number;
  courseIds: number[];
  enableOnCreate?: boolean;
}

// 创建载荷：服务端强制每人限领 1；默认不启用
export function toCouponCreatePayload(
  values: CouponFormValues,
): CouponTemplateCreateInput {
  return {
    name: values.name.trim(),
    discountCents: values.discountCents ?? 0,
    startAt: fromPickerValue(values.startAt),
    endAt: fromPickerValue(values.endAt),
    totalQty: values.totalQty,
    perUserLimit: 1,
    courseIds: values.courseIds,
    enableOnCreate: values.enableOnCreate ?? false,
  };
}

// 编辑载荷：perUserLimit 不提交，version 必带
export function toCouponUpdatePayload(
  values: CouponFormValues,
  version: number,
): CouponTemplateUpdateInput {
  return {
    version,
    name: values.name.trim(),
    discountCents: values.discountCents ?? 0,
    startAt: fromPickerValue(values.startAt),
    endAt: fromPickerValue(values.endAt),
    totalQty: values.totalQty,
    courseIds: values.courseIds,
  };
}

// 详情 → 表单值：启用态也只读回填，enableOnCreate 仅创建时使用
export function toCouponFormValues(
  template: AdminCouponTemplate,
): CouponFormValues {
  return {
    name: template.name ?? '',
    discountCents: template.discountCents ?? 0,
    startAt: toPickerValue(template.startAt ?? ''),
    endAt: toPickerValue(template.endAt ?? ''),
    totalQty: template.totalQty ?? 0,
    courseIds: [...(template.courseIds ?? [])],
    enableOnCreate: false,
  };
}
