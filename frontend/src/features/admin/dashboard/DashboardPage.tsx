import { Alert, Button, Card, Col, Row, Statistic } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { getDashboardStats } from '@/api/admin/dashboard';
import { queryKeys } from '@/api/query-keys';
import type { DashboardStats } from '@/api/types';
import { PageHeader } from '@/components/common/PageHeader';

// 统计卡片定义：money 表示分转元展示
const STAT_CARDS: Array<{
  key: keyof DashboardStats;
  title: string;
  money?: boolean;
}> = [
  { key: 'userCount', title: '用户总数' },
  { key: 'courseCount', title: '课程总数' },
  { key: 'publishedCourseCount', title: '已发布课程' },
  { key: 'orderCount', title: '订单总数' },
  { key: 'paidOrderCount', title: '已支付订单' },
  { key: 'revenueCents', title: '收入（元）', money: true },
  { key: 'ongoingGrouponCount', title: '进行中拼团' },
  { key: 'ongoingFlashSaleCount', title: '进行中秒杀' },
];

// 工作台页面：展示管理端统计卡片
export default function DashboardPage() {
  // 统计查询
  const query = useQuery({
    queryKey: queryKeys.dashboardStats,
    queryFn: getDashboardStats,
  });
  // 统计结果
  const stats = query.data;

  // 卡片数值：无数据时显示占位符，收入由分转元
  function valueOf(key: keyof DashboardStats, money?: boolean) {
    if (!stats) return '—';
    return money ? stats[key] / 100 : stats[key];
  }

  return (
    <div>
      <PageHeader title="工作台" />
      {query.isError && (
        <Alert
          type="error"
          showIcon
          message="工作台统计加载失败"
          description={query.error.message}
          style={{ marginBottom: 16 }}
          action={
            <Button onClick={() => void query.refetch()}>重试</Button>
          }
        />
      )}
      <Row gutter={[16, 16]}>
        {STAT_CARDS.map((item) => (
          <Col key={item.key} xs={24} sm={12} lg={6}>
            <Card loading={query.isLoading}>
              <Statistic
                title={item.title}
                value={valueOf(item.key, item.money)}
                prefix={item.money ? '¥' : undefined}
                precision={item.money ? 2 : 0}
              />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
