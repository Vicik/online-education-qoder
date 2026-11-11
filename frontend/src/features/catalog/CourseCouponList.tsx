import { Card, List } from 'antd';
import type { ReactNode } from 'react';
import type { CouponTemplateBrief } from '@/api/types';
import { formatCents } from '@/lib/money';
import { formatShanghai } from '@/lib/datetime';

// 课程详情可领券列表：步骤 06 只展示，步骤 09 通过 renderAction 注入领取按钮
export function CourseCouponList({
  coupons,
  renderAction,
}: {
  coupons: CouponTemplateBrief[];
  renderAction?: (coupon: CouponTemplateBrief) => ReactNode;
}) {
  if (coupons.length === 0) return null;

  return (
    <Card title="可领取优惠券" size="small" style={{ marginBottom: 16 }}>
      <List
        dataSource={coupons}
        renderItem={(coupon) => (
          <List.Item actions={renderAction ? [renderAction(coupon)] : undefined}>
            <List.Item.Meta
              title={`${coupon.name}（立减 ${formatCents(coupon.discountCents ?? 0)}）`}
              description={`${
                coupon.startAt ? formatShanghai(coupon.startAt) : '—'
              } 至 ${coupon.endAt ? formatShanghai(coupon.endAt) : '—'}`}
            />
          </List.Item>
        )}
      />
    </Card>
  );
}
