import { request } from './client';
import type { CouponClaim, PageResult } from './types';

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

// 领取优惠券：必须携带幂等键，重放返回首次结果
export function claimCoupon(templateId: number, idempotencyKey: string): Promise<CouponClaim> {
  return request<CouponClaim>({
    url: `/coupons/${templateId}/claim`,
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
