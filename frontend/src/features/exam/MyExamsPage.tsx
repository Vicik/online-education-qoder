import { Button, Pagination, Skeleton } from 'antd';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listMyExamRecords } from '@/api/exam';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { usePagination } from '@/hooks/usePagination';
import { formatShanghai } from '@/lib/datetime';
import '../user-center/records.css';

// 我的考试每页数量
const PAGE_SIZE = 10;

// 我的考试：成绩记录卡片流，点击标题或继续考试进入考试页
export default function MyExamsPage() {
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);

  // 我的考试记录查询
  const query = useQuery({
    queryKey: queryKeys.myExams(page),
    queryFn: () => listMyExamRecords(page, pageSize),
    placeholderData: (previous) => previous,
  });

  // 同步后端总数
  useEffect(() => {
    setTotal(query.data?.total ?? 0);
  }, [query.data?.total]);

  // 当前页记录
  const items = query.data?.items ?? [];

  // 卡片列表：加载占位、错误重试、空态与考试记录卡片
  let content;
  if (query.isLoading) {
    content = (
      <div className="record-list">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="record-card" active />
        ))}
      </div>
    );
  } else if (query.error) {
    content = (
      <EmptyState
        description="加载失败"
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  } else if (items.length === 0) {
    content = <EmptyState description="还没有考试记录" />;
  } else {
    content = (
      <>
        <div className="record-list">
          {items.map((record) => {
            // 交卷后展示成绩，未交卷展示继续考试入口
            const submitted = record.submittedAt !== null;
            // 成绩颜色：及格绿、不及格红
            const scoreColor = record.passed ? '#12a05c' : '#f5222d';

            return (
              <article
                key={record.attemptId}
                className="record-card exam-record"
              >
                <div className="exam-record-head">
                  <Link
                    className="exam-record-title"
                    to={`/exams/${record.examId}`}
                  >
                    {record.examTitle}
                  </Link>
                  <span
                    className="exam-record-status"
                    style={{ color: submitted ? '#12a05c' : '#fa8c16' }}
                  >
                    {submitted ? '考试完成' : '进行中'}
                  </span>
                </div>
                <div className="exam-record-meta">
                  <span>
                    <span className="exam-record-label">题目总数：</span>
                    {record.questionCount ?? 0}
                  </span>
                  <span>
                    <span className="exam-record-label">总分数：</span>
                    {record.totalScore ?? 0}
                  </span>
                  <span>
                    <span className="exam-record-label">及格分：</span>
                    {record.passScore ?? 0}
                  </span>
                </div>
                <div className="exam-record-bottom">
                  <span>
                    {record.submittedAt
                      ? formatShanghai(record.submittedAt)
                      : '尚未交卷'}
                  </span>
                  {submitted ? (
                    <span>
                      <span className="exam-record-label">最终得分：</span>
                      <span style={{ color: scoreColor }}>
                        {record.score ?? 0}
                      </span>
                    </span>
                  ) : (
                    <Link
                      className="exam-record-continue"
                      to={`/exams/${record.examId}`}
                    >
                      继续考试
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {total > 0 && (
          <div className="record-pagination">
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              onChange={onChange}
            />
          </div>
        )}
      </>
    );
  }

  return (
    <div>
      <PageHeader title="我的考试" />
      {content}
    </div>
  );
}
