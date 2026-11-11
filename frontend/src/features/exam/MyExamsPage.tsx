import { useEffect, useState } from 'react';
import { Tag } from 'antd';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listMyExamRecords } from '@/api/exam';
import { queryKeys } from '@/api/query-keys';
import type { MyExamRecord } from '@/api/types';
import { AppTable } from '@/components/common/AppTable';
import { PageHeader } from '@/components/common/PageHeader';
import { usePagination } from '@/hooks/usePagination';
import { formatShanghai } from '@/lib/datetime';

// 我的考试每页数量
const PAGE_SIZE = 10;

// 我的考试：成绩记录与继续考试入口
export default function MyExamsPage() {
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 我的考试记录查询
  const query = useQuery({
    queryKey: queryKeys.myExams(page),
    queryFn: () => listMyExamRecords(page, pageSize),
  });

  // 同步后端总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 表格列
  const columns = [
    { title: '考试', dataIndex: 'examTitle', key: 'examTitle' },
    {
      title: '得分',
      dataIndex: 'score',
      key: 'score',
      render: (value: number | null, record: MyExamRecord) =>
        value === null ? '未交卷' : `${value} / ${record.totalScore}`,
    },
    {
      title: '结果',
      dataIndex: 'passed',
      key: 'passed',
      render: (value: boolean | null) => {
        if (value === null) return '—';
        return <Tag color={value ? 'green' : 'red'}>{value ? '及格' : '不及格'}</Tag>;
      },
    },
    {
      title: '交卷时间',
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      render: (value: string | null) => (value ? formatShanghai(value) : '—'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: MyExamRecord) => (
        <Link to={`/exams/${record.examId}`}>
          {record.submittedAt ? '查看成绩' : '继续考试'}
        </Link>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="我的考试" />
      <AppTable
        columns={columns}
        dataSource={query.data?.items ?? []}
        rowKey="attemptId"
        total={total}
        page={page}
        pageSize={pageSize}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        onPageChange={onChange}
        emptyText="还没有考试记录"
      />
    </div>
  );
}
