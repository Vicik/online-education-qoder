import { Card, Space, Typography } from 'antd';
import { Link } from 'react-router';
import type { GrouponActivityBrief } from '@/api/types';
import { Countdown } from '@/components/common/Countdown';
import { MoneyText } from '@/components/common/MoneyText';

// 拼团活动卡片：名称、课程、拼团价、成团人数与结束倒计时
export function GrouponCard(props: { activity: GrouponActivityBrief; onExpire?: () => void }) {
  // 活动 id：详情页跳转目标
  const activityId = props.activity.id ?? 0;
  // 成团人数
  const targetSize = props.activity.targetSize ?? 0;

  return (
    <Card hoverable style={{ height: '100%' }}>
      <Link to={`/groupons/${activityId}`}>{props.activity.name ?? ''}</Link>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {props.activity.courseName ?? ''}
      </Typography.Paragraph>
      <Space direction="vertical" size={4}>
        <MoneyText cents={props.activity.priceCents ?? 0} />
        <Typography.Text type="secondary">{targetSize} 人成团</Typography.Text>
        <Countdown deadlineAt={props.activity.endAt ?? ''} prefix="距结束" onExpire={props.onExpire} />
      </Space>
    </Card>
  );
}
