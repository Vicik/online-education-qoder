import { Card, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router';
import type { FlashSaleActivityBrief } from '@/api/types';
import { Countdown } from '@/components/common/Countdown';
import { MoneyText } from '@/components/common/MoneyText';
import { formatShanghai } from '@/lib/datetime';

// 秒杀活动卡片：秒杀价、剩余库存、起止时间与倒计时
export function FlashSaleCard(props: { activity: FlashSaleActivityBrief; onExpire?: () => void }) {
  // 活动 id：详情页跳转目标
  const activityId = props.activity.id ?? 0;
  // 是否已售罄：以服务端剩余库存为准
  const soldOut = (props.activity.remaining ?? 0) <= 0;
  // 是否未开始：未开始倒计时到开始时间，其余倒计时到结束时间
  const notStarted = props.activity.status === 'not_started';
  // 倒计时截止时间
  const deadlineAt = (notStarted ? props.activity.startAt : props.activity.endAt) ?? '';

  return (
    <Card hoverable style={{ height: '100%' }}>
      <Link to={`/flash-sales/${activityId}`}>{props.activity.name ?? ''}</Link>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {props.activity.courseName ?? ''}
      </Typography.Paragraph>
      <Space direction="vertical" size={4}>
        <MoneyText cents={props.activity.priceCents ?? 0} />
        {soldOut ? (
          <Tag color="red">已售罄</Tag>
        ) : (
          <Typography.Text type="secondary">
            剩余 {props.activity.remaining ?? 0} 件
          </Typography.Text>
        )}
        <Typography.Text type="secondary">
          {formatShanghai(props.activity.startAt ?? '')} ~ {formatShanghai(props.activity.endAt ?? '')}
        </Typography.Text>
        <Countdown
          deadlineAt={deadlineAt}
          prefix={notStarted ? '距开始' : '距结束'}
          onExpire={props.onExpire}
        />
      </Space>
    </Card>
  );
}
