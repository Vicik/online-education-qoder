import { useEffect, useState } from 'react';
import { App as AntdApp, Button, Pagination } from 'antd';
import { InfoCircleFilled } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getRecommendations } from '@/api/catalog';
import { listExams, listMyExamRecords } from '@/api/exam';
import { queryKeys } from '@/api/query-keys';
import type { ExamBrief } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';
import { RecommendCourseCard } from '@/components/common/RecommendCourseCard';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import './exam.css';
import './ExamListPage.css';

// 列表每页数量
const PAGE_SIZE = 12;
// 我的考试记录拉取上限：仅用于判断列表卡片的已参加状态
const MINE_PAGE_SIZE = 100;
// 侧栏精品推荐展示数量
const RECOMMEND_SIZE = 4;

// 考试列表：左侧考试卡片流 + 右侧精品推荐
export default function ExamListPage() {
  // 当前总数（分页入参）
  const [total, setTotal] = useState(0);
  // 页码与页大小
  const { page, pageSize, onChange } = usePagination(total, PAGE_SIZE);
  // 路由跳转
  const navigate = useNavigate();
  // AntD 确认框
  const { modal } = AntdApp.useApp();
  // 当前用户：未登录不拉取考试记录
  const { user } = usePermission();

  // 已发布考试查询
  const query = useQuery({
    queryKey: queryKeys.exams(page),
    queryFn: () => listExams(page, pageSize),
  });

  // 我的考试记录：用于把已开始的考试标为「已参加」
  const mineQuery = useQuery({
    queryKey: queryKeys.myExamsAll,
    queryFn: () => listMyExamRecords(1, MINE_PAGE_SIZE),
    enabled: Boolean(user),
    retry: false,
  });

  // 侧栏精品推荐：与首页、课程详情共享缓存
  const recommendQuery = useQuery({
    queryKey: queryKeys.homeRecommendations,
    queryFn: getRecommendations,
  });

  // 同步后端总数
  useEffect(() => {
    if (query.data) setTotal(query.data.total);
  }, [query.data]);

  // 当前页考试
  const items = query.data?.items ?? [];
  // 已参加的考试 id 集合
  const joinedIds = new Set((mineQuery.data?.items ?? []).map((record) => record.examId));
  // 侧栏推荐课程
  const recommends = (recommendQuery.data ?? []).slice(0, RECOMMEND_SIZE);

  // 参加考试：确认后进入详情页并自动开始
  const handleJoin = (exam: ExamBrief) => {
    modal.confirm({
      icon: <InfoCircleFilled style={{ color: 'var(--color-cta)', fontSize: 22 }} />,
      title: '是否要参加该场考试？',
      okText: '立即考试',
      cancelText: '取消',
      // 参考图右上角有关闭按钮
      closable: true,
      // 绿色 CTA 与参考图一致
      okButtonProps: { autoInsertSpace: false, className: 'exam-confirm-ok' },
      cancelButtonProps: { autoInsertSpace: false },
      onOk: () => {
        // autoStart：详情页读取后省去二次确认，直接计时答题
        navigate(`/exams/${exam.id}`, { state: { autoStart: true } });
      },
    });
  };

  return (
    <div className="exam-page">
      <h1 className="exam-page-heading">考试</h1>
      <div className="exam-list">
        {items.length === 0 && !query.isLoading ? (
          <EmptyState description="暂无可参加的考试" />
        ) : (
          items.map((exam) => {
            // 是否已参加过该场考试
            const joined = joinedIds.has(exam.id ?? 0);
            return (
              <article key={exam.id} className="exam-card">
                <div className="exam-card-head">
                  <h2 className="exam-card-title">{exam.title}</h2>
                  <span className="exam-card-duration">时长：{exam.durationMin}分钟</span>
                </div>
                <div className="exam-card-meta">
                  <span>题目总数：{exam.questionCount ?? 0}</span>
                  <span>总分数：{exam.totalScore ?? 0}</span>
                  <span>及格分：{exam.passScore ?? 0}</span>
                </div>
                <div className="exam-card-actions">
                  {joined ? (
                    <Button className="exam-card-btn exam-card-btn-joined" disabled>
                      已参加
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      className="exam-card-btn exam-cta"
                      autoInsertSpace={false}
                      onClick={() => handleJoin(exam)}
                    >
                      立即考试
                    </Button>
                  )}
                </div>
              </article>
            );
          })
        )}
        {total > 0 && (
          <div className="exam-pagination">
            <Pagination current={page} pageSize={pageSize} total={total} onChange={onChange} />
          </div>
        )}
      </div>
      {recommends.length > 0 && (
        <aside className="exam-side" aria-label="精品推荐">
          <h2 className="exam-side-title">精品推荐</h2>
          <div className="exam-side-list">
            {recommends.map((course) => (
              <RecommendCourseCard key={course.id} course={course} />
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
