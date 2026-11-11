import { request } from './client';
import type { CouponClaim, PageResult } from './types';

// 我的券状态：与后端 CouponClaimStatus 一致
export type CouponStatus = 'unused' | 'used' | 'expired' | 'invalid' | 'restored';

// 我的优惠券分页：结算页只看 unused，步骤 09 扩展到四状态筛选
export function listMyCoupons(
  status: CouponStatus,
  page = 1,
  pageSize = 20,
): Promise<PageResult<CouponClaim>> {
  return request<PageResult<CouponClaim>>({
    url: '/user/coupons',
    method: 'GET',
    params: { status, page, pageSize },
  });
}
