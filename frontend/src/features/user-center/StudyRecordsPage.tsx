import { Button, Progress, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { listStudyRecords } from '@/api/learning';
import { queryKeys } from '@/api/query-keys';
import type { StudyRecord } from '@/api/types';
import { AppTable } from '@/components/common/AppTable';
import { PageHeader } from '@/components/common/PageHeader';
import { formatShanghai } from '@/lib/datetime';
import { usePagination } from '@/hooks/usePagination';

// 学习记录每页数量
const PAGE_SIZE = 20;

// 学习记录：按课程聚合的进度与最近章节
export default function StudyRecordsPage() {
  // 跳转
  const navigate = useNavigate();
  // 记录总数（首屏 0，响应后回填）
  const [total, setTotal] = useState(0);
  // 分页状态
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);
  // 学习记录
  const query = useQuery({
    queryKey: queryKeys.studyRecords(page),
    queryFn: () => listStudyRecords(page, pageSize),
  });

  // 响应总数同步给分页组件
  useEffect(() => {
    setTotal(query.data?.total ?? 0);
  }, [query.data?.total]);

  return (
    <div>
      <PageHeader title="学习记录" />
      <AppTable<StudyRecord>
        rowKey="courseId"
        dataSource={query.data?.items ?? []}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={onChange}
        emptyText="暂无学习记录"
        columns={[
          { title: '课程', dataIndex: 'courseName' },
          {
            title: '进度',
            dataIndex: 'progressPercent',
            width: 220,
            render: (value: number) => (
              <Progress percent={value} size="small" format={(percent) => `${percent}%`} />
            ),
          },
          {
            title: '状态',
            dataIndex: 'completed',
            width: 100,
            render: (completed: boolean) =>
              completed ? <Tag color="green">已学完</Tag> : <Tag>学习中</Tag>,
          },
          {
            title: '最近章节',
            dataIndex: 'lastChapterTitle',
            render: (title: string | null) => title ?? '—',
          },
          {
            title: '最后学习时间',
            dataIndex: 'lastVisitedAt',
            render: (value: string) => formatShanghai(value),
          },
          {
            title: '操作',
            width: 120,
            render: (_: unknown, record: StudyRecord) => (
              <Button
                type="link"
                onClick={() =>
                  navigate(
                    `/learning/${record.courseId}${record.lastChapterId ? `?chapterId=${record.lastChapterId}` : ''}`,
                  )
                }
              >
                继续学习
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
