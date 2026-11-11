import { request } from './client';
import type {
  CouponClaim,
  CouponTemplateBrief,
  GrouponActivityBrief,
  GrouponDetail,
  GrouponGroup,
  Order,
  PageResult,
} from './types';

// 我的券状态：与后端 CouponClaimStatus 一致
export type CouponStatus = 'unused' | 'used' | 'expired' | 'invalid' | 'restored';

// 我的优惠券分页：结算页只看 unused；不传状态时返回全部领取记录
export function listMyCoupons(
  status?: CouponStatus,
  page = 1,
  pageSize = 20,
): Promise<PageResult<CouponClaim>> {
  return request<PageResult<CouponClaim>>({
    url: '/user/coupons',
    method: 'GET',
    params: { ...(status ? { status } : {}), page, pageSize },
  });
}

// 课程详情可领券列表（公开；启用 + 有效期内 + 适用该课程 + 未发完）
export function listCourseCoupons(courseId: number): Promise<CouponTemplateBrief[]> {
  return request<CouponTemplateBrief[]>({
    url: `/courses/${courseId}/coupons`,
    method: 'GET',
  });
}

// 领取优惠券：必须携带幂等键，重放返回首次结果
export function claimCoupon(templateId: number, idempotencyKey: string): Promise<CouponClaim> {
  return request<CouponClaim>({
    url: `/coupons/${templateId}/claim`,
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 拼团活动列表（公开；后端仅返回进行中活动，按开始时间正序分页）
export function listGroupons(
  page = 1,
  pageSize = 12,
): Promise<PageResult<GrouponActivityBrief>> {
  return request<PageResult<GrouponActivityBrief>>({
    url: '/groupons',
    method: 'GET',
    params: { page, pageSize },
  });
}

// 拼团详情：活动信息 + 仅待成团的团组
export function getGroupon(activityId: number): Promise<GrouponDetail> {
  return request<GrouponDetail>({
    url: `/groupons/${activityId}`,
    method: 'GET',
  });
}

// 发起新团：必须携带幂等键，返回待支付订单与新建团组
export function createGrouponGroup(
  activityId: number,
  idempotencyKey: string,
): Promise<{ order: Order; group: GrouponGroup }> {
  return request<{ order: Order; group: GrouponGroup }>({
    url: `/groupons/${activityId}/groups`,
    method: 'POST',
    data: {},
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 加入待成团团组：必须携带幂等键，返回待支付订单与团组
export function joinGrouponGroup(
  activityId: number,
  groupId: number,
  idempotencyKey: string,
): Promise<{ order: Order; group: GrouponGroup }> {
  return request<{ order: Order; group: GrouponGroup }>({
    url: `/groupons/${activityId}/groups/${groupId}/join`,
    method: 'POST',
    data: {},
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
