import { useEffect, useState } from 'react';
import { Card, Pagination, Space, Typography } from 'antd';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listExams } from '@/api/exam';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { usePagination } from '@/hooks/usePagination';

// 列表每页数量
const PAGE_SIZE = 12;

// 考试列表：仅已发布考试
export default function ExamListPage() {
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 已发布考试查询
  const query = useQuery({
    queryKey: queryKeys.exams(page),
    queryFn: () => listExams(page, pageSize),
  });

  // 同步后端总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 当前页考试
  const items = query.data?.items ?? [];

  return (
    <div>
      <PageHeader title="考试" />
      {items.length === 0 && !query.isLoading ? (
        <EmptyState description="暂无可参加的考试" />
      ) : (
        items.map((exam) => (
          <Card key={exam.id} style={{ marginBottom: 12 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {exam.title}
              </Typography.Title>
              {exam.description && (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  {exam.description}
                </Typography.Paragraph>
              )}
              <Typography.Text>时长：{exam.durationMin} 分钟</Typography.Text>
              <Typography.Text>题数：{exam.questionCount}</Typography.Text>
              <Typography.Text>
                及格分 {exam.passScore} / 总分 {exam.totalScore}
              </Typography.Text>
              <Link to={`/exams/${exam.id}`}>进入考试</Link>
            </Space>
          </Card>
        ))
      )}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
        <Pagination
          current={page}
          pageSize={pageSize}
          total={total}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
