import { Link } from 'react-router';
import type { CouponClaim } from '@/api/types';
import { formatShanghai } from '@/lib/datetime';
import { formatCents } from '@/lib/money';
import './CouponCard.css';

// 非未使用状态 → 卡片右下角文案
const STATUS_TEXT: Record<string, string> = {
  used: '已使用',
  expired: '已过期',
  invalid: '已失效',
  restored: '未使用',
};

// 券「去使用」目标：仅未使用可用；进入券结算页，适用课程由该页选择
function couponTarget(coupon: CouponClaim): string | null {
  // 非未使用状态或券记录缺失时不提供入口
  if (coupon.status !== 'unused' || coupon.id === undefined) return null;
  return `/checkout/coupon/${coupon.id}`;
}

// 适用课程文案：单课程显示名称，多课程显示首个与总数
function courseText(names: string[]): string {
  if (names.length === 0) return '—';
  return names.length === 1 ? names[0] : `${names[0]} 等 ${names.length} 门课程`;
}

// 我的优惠券卡片：面额、适用课程、有效期与右下角操作
export function CouponCard({ coupon }: { coupon: CouponClaim }) {
  // 去使用目标（不可用为 null）
  const target = couponTarget(coupon);
  // 状态文案：未使用不展示，其余状态显示在右下角
  const statusText = STATUS_TEXT[coupon.status ?? ''] ?? coupon.status ?? '';

  return (
    <article
      className={`coupon-card ${target ? 'coupon-card-usable' : 'coupon-card-disabled'}`}
    >
      <div className="coupon-card-amount">
        {formatCents(coupon.discountCents ?? 0)}
      </div>
      <div className="coupon-card-course">
        适用课程：{courseText(coupon.courseNames ?? [])}
      </div>
      <div className="coupon-card-validity">
        有效期：
        {coupon.startAt ? formatShanghai(coupon.startAt) : '—'} ~{' '}
        {coupon.endAt ? formatShanghai(coupon.endAt) : '—'}
      </div>
      <div className="coupon-card-footer">
        {target ? (
          <Link className="coupon-card-action" to={target}>
            立即使用
          </Link>
        ) : (
          <span className="coupon-card-status">{statusText}</span>
        )}
      </div>
    </article>
  );
}
