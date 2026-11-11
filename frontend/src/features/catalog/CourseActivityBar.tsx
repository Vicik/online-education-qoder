import { Card, Tag, Typography } from 'antd';
import { Link } from 'react-router';
import type { FlashSaleActivityBrief, GrouponActivityBrief } from '@/api/types';
import { Countdown } from '@/components/common/Countdown';
import { MoneyText } from '@/components/common/MoneyText';

// 课程详情活动条：拼团与秒杀可同时存在，各自一行
export function CourseActivityBar({
  groupon,
  flashSale,
}: {
  groupon: GrouponActivityBrief | null;
  flashSale: FlashSaleActivityBrief | null;
}) {
  if (!groupon && !flashSale) return null;

  return (
    <Card size="small" className="course-activity-bar">
      {groupon && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Tag color="red">拼团</Tag>
          <Typography.Text strong>{groupon.name}</Typography.Text>
          <MoneyText cents={groupon.priceCents ?? 0} />
          <Typography.Text type="secondary">{groupon.targetSize} 人成团</Typography.Text>
          <Countdown deadlineAt={groupon.endAt ?? ''} prefix="剩余" />
          <Link to={`/groupons/${groupon.id}`}>去拼团</Link>
        </div>
      )}
      {flashSale && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginTop: groupon ? 8 : 0,
          }}
        >
          <Tag color="orange">秒杀</Tag>
          <Typography.Text strong>{flashSale.name}</Typography.Text>
          <MoneyText cents={flashSale.priceCents ?? 0} />
          <Typography.Text type="secondary">
            剩余 {Math.max((flashSale.stock ?? 0) - (flashSale.sold ?? 0), 0)} 件
          </Typography.Text>
          <Countdown deadlineAt={flashSale.endAt ?? ''} prefix="剩余" />
          <Link to={`/flash-sales/${flashSale.id}`}>去秒杀</Link>
        </div>
      )}
    </Card>
  );
}
