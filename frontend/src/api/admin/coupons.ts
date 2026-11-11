import { request } from '../client';
import type {
  AdminCouponTemplate,
  CouponTemplateCreateInput,
  CouponTemplateStatus,
  CouponTemplateUpdateInput,
  PageResult,
} from '../types';

// 优惠券模板列表：可按启停状态筛选
export function listAdminCoupons(
  page = 1,
  pageSize = 10,
  status?: CouponTemplateStatus,
): Promise<PageResult<AdminCouponTemplate>> {
  return request<PageResult<AdminCouponTemplate>>({
    url: '/admin/coupons',
    method: 'GET',
    params: { page, pageSize, ...(status ? { status } : {}) },
  });
}

// 创建优惠券模板：默认停用；创建类 POST 携带幂等键
export function createCouponTemplate(
  input: CouponTemplateCreateInput,
  idempotencyKey: string,
): Promise<AdminCouponTemplate> {
  return request<AdminCouponTemplate>({
    url: '/admin/coupons',
    method: 'POST',
    data: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 优惠券模板详情：编辑页回填与 version 来源
export function getCouponTemplate(
  templateId: number,
): Promise<AdminCouponTemplate> {
  return request<AdminCouponTemplate>({
    url: `/admin/coupons/${templateId}`,
    method: 'GET',
  });
}

// 编辑优惠券模板：仅停用态可改，version 必带
export function updateCouponTemplate(
  templateId: number,
  input: CouponTemplateUpdateInput,
): Promise<AdminCouponTemplate> {
  return request<AdminCouponTemplate>({
    url: `/admin/coupons/${templateId}`,
    method: 'PUT',
    data: input,
  });
}

// 启用优惠券模板：仅停用态可执行
export function enableCouponTemplate(
  templateId: number,
): Promise<AdminCouponTemplate> {
  return request<AdminCouponTemplate>({
    url: `/admin/coupons/${templateId}/enable`,
    method: 'POST',
  });
}

// 停用优惠券模板：服务端级联未使用/已恢复记录为永久失效
export function disableCouponTemplate(
  templateId: number,
): Promise<AdminCouponTemplate> {
  return request<AdminCouponTemplate>({
    url: `/admin/coupons/${templateId}/disable`,
    method: 'POST',
  });
}
