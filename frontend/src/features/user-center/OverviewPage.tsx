import { Card, Col, Row, Statistic } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getOverview } from '@/api/user';
import { queryKeys } from '@/api/query-keys';
import { PageHeader } from '@/components/common/PageHeader';

// 概览卡片定义：标题 + 字段 + 跳转
const CARDS = [
  { title: '已购课程', field: 'enrolledCount', to: '/user/study-records' },
  { title: '已学完', field: 'completedCount', to: '/user/study-records' },
  { title: '我的收藏', field: 'favoriteCount', to: '/user/favorites' },
  { title: '我的优惠券', field: 'couponCount', to: '/user/coupons' },
  { title: '我的帖子', field: 'postCount', to: '/user/posts' },
] as const;

// 学习概览：五项统计 + 快捷入口
export default function OverviewPage() {
  // 统计数据
  const query = useQuery({ queryKey: queryKeys.overview, queryFn: getOverview });

  return (
    <div>
      <PageHeader title="学习概览" />
      <Row gutter={[16, 16]}>
        {CARDS.map((card) => (
          <Col key={card.field} xs={24} sm={12} lg={8}>
            <Link to={card.to}>
              <Card hoverable loading={query.isLoading}>
                <Statistic title={card.title} value={query.data?.[card.field] ?? 0} />
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
