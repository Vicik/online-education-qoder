import { Button, Pagination, Progress, Skeleton } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { listStudyRecords } from '@/api/learning';
import { queryKeys } from '@/api/query-keys';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { usePagination } from '@/hooks/usePagination';
import './records.css';

// 学习记录每页数量
const PAGE_SIZE = 20;

// 课程类型 → 卡片标签文案
const TYPE_LABELS: Record<'video' | 'audio', string> = {
  video: '视频',
  audio: '音频',
};

// 学习记录：按课程聚合的进度与最近章节，卡片流展示
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
    placeholderData: (previous) => previous,
  });

  // 响应总数同步给分页组件
  useEffect(() => {
    setTotal(query.data?.total ?? 0);
  }, [query.data?.total]);

  // 当前页记录
  const items = query.data?.items ?? [];

  // 卡片列表：加载占位、错误重试、空态与记录卡片
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
    content = <EmptyState description="暂无学习记录" />;
  } else {
    content = (
      <>
        <div className="record-list">
          {items.map((record) => (
            <article
              key={record.courseId}
              className="record-card study-record"
            >
              <div className="study-record-progress-label">学习进度</div>
              <Progress
                className="study-record-progress"
                percent={record.progressPercent ?? 0}
                showInfo={false}
                status="normal"
                strokeLinecap="round"
              />
              <div className="study-record-main">
                <span className="study-record-type">
                  {record.type ? TYPE_LABELS[record.type] : '课程'}
                </span>
                <span
                  className="study-record-name"
                  title={record.courseName}
                >
                  {record.courseName}
                </span>
                <Button
                  type="primary"
                  className="study-record-action"
                  onClick={() =>
                    navigate(
                      `/learning/${record.courseId}${record.lastChapterId ? `?chapterId=${record.lastChapterId}` : ''}`,
                    )
                  }
                >
                  继续观看
                </Button>
              </div>
            </article>
          ))}
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
      <PageHeader title="学习记录" />
      {content}
    </div>
  );
}
