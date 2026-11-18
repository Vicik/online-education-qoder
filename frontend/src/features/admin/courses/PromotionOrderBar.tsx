import { Button, Space, Tooltip, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';

// 宣传位数量上限：与后端 PROMOTION_LIMIT 一致
export const PROMOTION_LIMIT = 5;

// 排序条消费的最小字段集
export interface PromotionOrderItem {
  id: number; // 课程 id
  name: string; // 课程名称
}

// 宣传位排序条：按当前顺序展示宣传课程，支持逐位上下移动
export function PromotionOrderBar({
  items,
  onMove,
}: {
  // 当前宣传课程，按宣传位序号升序
  items: PromotionOrderItem[];
  // 移动回调：把 from 位置的课程移到 to 位置
  onMove: (from: number, to: number) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        padding: '12px 16px',
        background: '#fafafa',
        borderRadius: 8,
      }}
    >
      <Typography.Text strong>{`首页宣传位（${items.length}/${PROMOTION_LIMIT}）`}</Typography.Text>
      {items.length === 0 ? (
        <Typography.Text type="secondary">
          还没有宣传课程，在下方课程列表点「宣传」即可加入首页 banner
        </Typography.Text>
      ) : (
        <Space wrap size={12}>
          {items.map((item, index) => (
            <Space key={item.id} size={4}>
              <Typography.Text>{`${index + 1}. ${item.name}`}</Typography.Text>
              <Tooltip title="上移">
                <Button
                  size="small"
                  icon={<ArrowUpOutlined />}
                  aria-label={`上移《${item.name}》`}
                  disabled={index === 0}
                  onClick={() => onMove(index, index - 1)}
                />
              </Tooltip>
              <Tooltip title="下移">
                <Button
                  size="small"
                  icon={<ArrowDownOutlined />}
                  aria-label={`下移《${item.name}》`}
                  disabled={index === items.length - 1}
                  onClick={() => onMove(index, index + 1)}
                />
              </Tooltip>
            </Space>
          ))}
        </Space>
      )}
    </div>
  );
}
