import { Card, List, Space, Typography } from 'antd';
import { Link } from 'react-router';
import type { CouponClaim } from '@/api/types';
import { MoneyText } from '@/components/common/MoneyText';
import { StatusTag } from '@/components/common/StatusTag';
import { formatShanghai } from '@/lib/datetime';

// 券「去使用」目标：仅未使用可用；单课程跳详情，多课程跳列表
function couponTarget(coupon: CouponClaim): string | null {
  // 非未使用状态不提供入口
  if (coupon.status !== 'unused') return null;
  // 适用课程 id 列表
  const courseIds = coupon.courseIds ?? [];
  return courseIds.length === 1 ? `/courses/${courseIds[0]}` : '/courses';
}

// 我的优惠券卡片：折扣、名称、有效期、适用课程数与状态
export function CouponCard(props: { coupon: CouponClaim }) {
  // 去使用目标（不可用为 null）
  const target = couponTarget(props.coupon);
  // 适用课程数
  const courseCount = props.coupon.courseIds?.length ?? 0;

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <List.Item
        actions={
          target
            ? [<Link key="use" to={target}>去使用</Link>]
            : undefined
        }
      >
        <List.Item.Meta
          title={
            <Space>
              <Typography.Text strong>{props.coupon.templateName ?? ''}</Typography.Text>
              <StatusTag domain="coupon" status={props.coupon.status ?? ''} />
            </Space>
          }
          description={
            <Space direction="vertical" size={4}>
              <Space>
                <Typography.Text type="secondary">立减</Typography.Text>
                <MoneyText cents={props.coupon.discountCents ?? 0} />
              </Space>
              <Typography.Text type="secondary">
                有效期：
                {props.coupon.startAt ? formatShanghai(props.coupon.startAt) : '—'} ~{' '}
                {props.coupon.endAt ? formatShanghai(props.coupon.endAt) : '—'}
              </Typography.Text>
              <Typography.Text type="secondary">适用 {courseCount} 门课程</Typography.Text>
            </Space>
          }
        />
      </List.Item>
    </Card>
  );
}
