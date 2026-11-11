import type { ReactNode } from 'react';
import type { CouponTemplateBrief } from '@/api/types';
import { formatShanghai } from '@/lib/datetime';
import { formatCents } from '@/lib/money';
import './CourseCouponList.css';

// 课程详情可领券：弹层内橙色券卡，已领取的券置灰
export function CourseCouponList({
  coupons,
  courseName,
  renderAction,
  claimedIds,
}: {
  coupons: CouponTemplateBrief[];
  courseName: string;
  renderAction?: (coupon: CouponTemplateBrief) => ReactNode;
  claimedIds?: ReadonlySet<number>;
}) {
  if (coupons.length === 0) return null;

  return (
    <div className="coupon-panel">
      <div className="coupon-panel-title">可用优惠券({coupons.length})</div>
      <div className="coupon-panel-list">
        {coupons.map((coupon) => (
          <article
            className={`coupon-card${
              coupon.id !== undefined && claimedIds?.has(coupon.id) ? ' coupon-card--claimed' : ''
            }`}
            key={coupon.id}
          >
            <div className="coupon-card-amount">{formatCents(coupon.discountCents ?? 0)}</div>
            <p className="coupon-card-name">{coupon.name}</p>
            <p className="coupon-card-line">适用课程：{courseName}</p>
            <p className="coupon-card-line">
              有效期：{coupon.startAt ? formatShanghai(coupon.startAt) : '—'} ~{' '}
              {coupon.endAt ? formatShanghai(coupon.endAt) : '—'}
            </p>
            {renderAction && <div className="coupon-card-action">{renderAction(coupon)}</div>}
          </article>
        ))}
      </div>
    </div>
  );
}
