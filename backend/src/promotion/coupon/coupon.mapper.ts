import { CouponClaimStatus, Prisma } from '@prisma/client';
import { CouponTemplateBrief } from '../../catalog/course.service';

// 券模板查询字段：统一供管理端、可领列表与领取结果复用
export const COUPON_TEMPLATE_SELECT = {
  id: true,
  name: true,
  discountCents: true,
  startAt: true,
  endAt: true,
  totalQty: true,
  claimedCount: true,
  status: true,
  version: true,
  courses: { select: { courseId: true } },
} as const;

// 券模板查询结果行类型
export type CouponTemplateRow = Prisma.CouponTemplateGetPayload<{
  select: typeof COUPON_TEMPLATE_SELECT;
}>;

// 券模板响应：openapi CouponTemplateBrief + 管理端编辑所需的乐观锁版本号
export type CouponTemplateView = CouponTemplateBrief & {
  version: number;
};

// 将券模板行映射为 openapi CouponTemplateBrief（关联课程转为 courseIds）
export function toCouponTemplateBrief(
  row: CouponTemplateRow,
): CouponTemplateView {
  return {
    id: row.id,
    name: row.name,
    discountCents: row.discountCents,
    startAt: row.startAt,
    endAt: row.endAt,
    totalQty: row.totalQty,
    claimedCount: row.claimedCount,
    status: row.status,
    version: row.version,
    courseIds: row.courses.map((course) => course.courseId),
  };
}

// 领取记录查询字段：模板信息额外带出适用课程名称，避免逐条二次查询
export const COUPON_CLAIM_TEMPLATE_SELECT = {
  ...COUPON_TEMPLATE_SELECT,
  courses: {
    select: { courseId: true, course: { select: { name: true } } },
  },
} as const;

// 领取记录查询字段：含模板信息，避免逐条二次查询
export const COUPON_CLAIM_INCLUDE = {
  template: { select: COUPON_CLAIM_TEMPLATE_SELECT },
} as const;

// 领取记录查询结果行类型
export type CouponClaimRow = Prisma.CouponClaimGetPayload<{
  include: typeof COUPON_CLAIM_INCLUDE;
}>;

// 领取记录响应：openapi CouponClaim + 模板展示字段与限领键
export interface CouponClaim {
  id: number; // 领取记录 id
  templateId: number; // 券模板 id
  templateName: string; // 券名称
  discountCents: number; // 抵扣面额（分）
  startAt: Date; // 生效时间
  endAt: Date; // 失效时间
  courseIds: number[]; // 适用课程 id
  courseNames: string[]; // 适用课程名称
  status: CouponClaimStatus; // 领取状态
  claimKey: string | null; // 限领键（invalid 时为 null）
  claimedAt: Date; // 领取时间
  usedAt: Date | null; // 使用时间
}

// 将领取记录行映射为接口响应
export function toCouponClaim(row: CouponClaimRow): CouponClaim {
  return {
    id: row.id,
    templateId: row.templateId,
    templateName: row.template.name,
    discountCents: row.template.discountCents,
    startAt: row.template.startAt,
    endAt: row.template.endAt,
    courseIds: row.template.courses.map((course) => course.courseId),
    courseNames: row.template.courses.map((course) => course.course.name),
    status: row.status,
    claimKey: row.claimKey,
    claimedAt: row.claimedAt,
    usedAt: row.usedAt,
  };
}

// 生成限领唯一键：同一模板同一用户在一段启用周期内只允许一条未失效记录
export function claimKeyOf(templateId: number, userId: number): string {
  return `template:${templateId}:user:${userId}`;
}
