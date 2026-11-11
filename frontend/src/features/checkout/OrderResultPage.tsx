import { Button, Card, Descriptions, Result, Space, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { getOrder } from '@/api/trade';
import { queryKeys } from '@/api/query-keys';
import { StatusTag } from '@/components/common/StatusTag';
import { formatCents } from '@/lib/money';
import { formatShanghai } from '@/lib/datetime';

// 支付结果：按订单状态给出文案与后续入口
export default function OrderResultPage() {
  // 路由订单 id
  const { id: rawId } = useParams();
  // 解析后的订单 id
  const orderId = Number(rawId);
  // 订单详情
  const query = useQuery({
    queryKey: queryKeys.order(orderId),
    queryFn: () => getOrder(orderId),
    enabled: Number.isInteger(orderId) && orderId > 0,
  });

  if (query.isLoading) return <Card loading />;
  if (query.error || !query.data) {
    return <Result status="404" title="订单不存在" extra={<Link to="/user/orders">返回购买记录</Link>} />;
  }

  // 当前订单
  const order = query.data;
  // 拼团订单
  const isGroupon = order.activityType === 'groupon';

  // 主状态文案
  const resultStatus: 'success' | 'warning' | 'info' =
    order.status === 'paid' ? 'success' : order.status === 'refunded' ? 'warning' : 'info';
  // 主标题
  const title =
    order.status === 'paid'
      ? '支付成功'
      : order.status === 'refunded'
        ? '退款成功（模拟）'
        : order.status === 'cancelled'
          ? '订单已取消'
          : '订单待支付';

  return (
    <Result
      status={resultStatus}
      title={title}
      subTitle={
        order.status === 'refunded'
          ? '模拟退款已原路退回（不涉及真实资金），使用的优惠券已恢复。'
          : isGroupon && order.status === 'paid'
            ? '拼团待成团，成团后即可开始学习。'
            : undefined
      }
      extra={
        <Space>
          {order.status === 'paid' && !isGroupon && (
            <Link to={`/learning/${order.courseId}`}>
              <Button type="primary">去学习</Button>
            </Link>
          )}
          {isGroupon && <Link to="/groupons"><Button>去拼团列表</Button></Link>}
          <Link to="/user/orders"><Button>购买记录</Button></Link>
        </Space>
      }
    >
      <Card>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="订单号">{order.orderNo}</Descriptions.Item>
          <Descriptions.Item label="课程">{order.courseName}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <StatusTag domain="order" status={order.status ?? ''} />
          </Descriptions.Item>
          <Descriptions.Item label="原价">{formatCents(order.originalCents ?? 0)}</Descriptions.Item>
          <Descriptions.Item label="当前价">{formatCents(order.currentCents ?? 0)}</Descriptions.Item>
          <Descriptions.Item label="优惠">-{formatCents(order.discountCents ?? 0)}</Descriptions.Item>
          <Descriptions.Item label="实付">
            <Typography.Text strong>{formatCents(order.paidCents ?? 0)}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="下单时间">
            {order.createdAt ? formatShanghai(order.createdAt) : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="支付时间">
            {order.paidAt ? formatShanghai(order.paidAt) : '—'}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </Result>
  );
}
