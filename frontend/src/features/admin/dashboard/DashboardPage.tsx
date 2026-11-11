// 管理端工作台：一期占位；GET /admin/dashboard/stats 就绪后接入
import { Alert, Card, Col, Row, Statistic } from 'antd';
import { PageHeader } from '@/components/common/PageHeader';

// 占位统计卡片：接口未实现前不展示任何虚构数字
const PLACEHOLDER_STATS = [
  { key: 'userCount', title: '用户总数' },
  { key: 'courseCount', title: '课程总数' },
  { key: 'publishedCourseCount', title: '已发布课程' },
  { key: 'orderCount', title: '订单总数' },
  { key: 'paidOrderCount', title: '已支付订单' },
  { key: 'revenueCents', title: '收入（元）' },
  { key: 'ongoingGrouponCount', title: '进行中拼团' },
  { key: 'ongoingFlashSaleCount', title: '进行中秒杀' },
];

// 工作台页面：仅占位卡片与说明，不请求未开放的统计接口
export default function DashboardPage() {
  return (
    <div>
      <PageHeader title="工作台" />
      <Alert
        type="info"
        showIcon
        message="统计接口尚未开放"
        description="工作台统计接口（GET /admin/dashboard/stats）就绪后将在此展示真实数据；当前仅保留占位卡片。"
        style={{ marginBottom: 16 }}
      />
      <Row gutter={[16, 16]}>
        {PLACEHOLDER_STATS.map((item) => (
          <Col key={item.key} xs={24} sm={12} lg={6}>
            <Card>
              <Statistic title={item.title} value="—" />
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
