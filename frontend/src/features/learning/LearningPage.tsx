import { Button, Card, Progress, Space, Tabs, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { getCourseDetail, getRecommendations } from '@/api/catalog';
import { ApiError, getErrorAction } from '@/api/errors';
import {
  getChapterContent,
  listStudyRecords,
  recordChapterVisit,
  type LearningProgress,
} from '@/api/learning';
import { queryKeys } from '@/api/query-keys';
import type { ChapterBrief } from '@/api/types';
import { CourseMiniCard } from '@/components/common/CourseMiniCard';
import { EmptyState } from '@/components/common/EmptyState';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { ChapterNav } from './ChapterNav';
import { ChapterViewer } from './ChapterViewer';
import './LearningPage.css';

// 初始章节：优先 URL 指定，其次学习记录中的最近章节，最后第一章
export function resolveInitialChapterId(
  chapters: ChapterBrief[],
  requestedChapterId: number | null,
  lastChapterId: number | null | undefined,
): number | null {
  // URL 指定且属于本课程
  if (requestedChapterId !== null && chapters.some((chapter) => chapter.id === requestedChapterId)) {
    return requestedChapterId;
  }
  // 学习记录的最近章节
  if (lastChapterId != null && chapters.some((chapter) => chapter.id === lastChapterId)) {
    return lastChapterId;
  }
  // 兜底第一章
  return chapters[0]?.id ?? null;
}

// 学习页：顶部播放器 + 详情/章节双页签 + 右侧精品推荐
export default function LearningPage() {
  // 路由课程 id
  const { courseId: rawCourseId } = useParams();
  // 解析后的课程 id
  const courseId = Number(rawCourseId);
  // id 合法才发起请求
  const validCourseId = Number.isInteger(courseId) && courseId > 0;
  // URL 查询参数与写入器
  const [searchParams, setSearchParams] = useSearchParams();
  // 请求的章节 id（非法时为 null）
  const requestedChapterId = Number(searchParams.get('chapterId')) || null;
  // 跳转
  const navigate = useNavigate();
  // QueryClient：完成章节后失效学习记录
  const queryClient = useQueryClient();
  // 本次会话播放完成的章节（本地即时标记）
  const [visitedChapterIds, setVisitedChapterIds] = useState<Set<number>>(() => new Set());
  // 最近一次上报返回的进度
  const [progress, setProgress] = useState<LearningProgress | null>(null);
  // 已上报完成的章节 id，避免重复播放反复上报
  const reportedChapterRef = useRef<Set<number>>(new Set());

  // 课程详情（章节名、简介与推荐位所需封面）
  const courseQuery = useQuery({
    queryKey: queryKeys.course(courseId),
    queryFn: () => getCourseDetail(courseId),
    enabled: validCourseId,
  });
  // 学习记录：仅用于取最近章节
  const recordsQuery = useQuery({
    queryKey: queryKeys.studyRecords(1),
    queryFn: () => listStudyRecords(1, 100),
    enabled: validCourseId,
  });
  // 精品推荐：与首页、课程详情共享缓存
  const recommendationsQuery = useQuery({
    queryKey: queryKeys.homeRecommendations,
    queryFn: getRecommendations,
    enabled: validCourseId,
  });

  // 本课程的学习记录
  const currentRecord = recordsQuery.data?.items.find((item) => item.courseId === courseId);
  // 最近学习章节
  const lastChapterId = currentRecord?.lastChapterId;

  // 无 URL 指定章节时，等学习记录就绪再定初始章节，避免先打开第一章再跳走
  const recordsReady = requestedChapterId !== null || recordsQuery.isFetched;

  // 章节列表（稳定引用）
  const chapters = useMemo(() => courseQuery.data?.chapters ?? [], [courseQuery.data]);

  // 当前章节 id
  const activeChapterId = resolveInitialChapterId(chapters, requestedChapterId, lastChapterId);

  // 当前章节
  const currentChapter = chapters.find((chapter) => chapter.id === activeChapterId);

  // 当前章节正文
  const contentQuery = useQuery({
    queryKey: queryKeys.courseContent(courseId, activeChapterId ?? 0),
    queryFn: () => getChapterContent(courseId, activeChapterId as number),
    enabled: activeChapterId !== null && recordsReady && validCourseId,
    retry: false,
  });

  // 上报播放完成：成功后更新进度并标记已学
  const { mutate: reportVisit } = useMutation({
    mutationFn: (chapterId: number) => recordChapterVisit(courseId, chapterId),
    onSuccess: (result, chapterId) => {
      setProgress(result);
      setVisitedChapterIds((previous) => new Set(previous).add(chapterId));
      queryClient.invalidateQueries({ queryKey: queryKeys.studyRecordsRoot });
    },
    onError: (_error, chapterId) => {
      // 上报失败允许下次播放结束重试
      reportedChapterRef.current.delete(chapterId);
    },
  });

  // 播放结束：同一章节只上报一次；重复播放不改变已学标记
  function handleMediaEnded() {
    if (activeChapterId === null) return;
    if (reportedChapterRef.current.has(activeChapterId)) return;
    reportedChapterRef.current.add(activeChapterId);
    reportVisit(activeChapterId);
  }

  // 切换章节：写入 URL，刷新后保持
  function selectChapter(chapterId: number): void {
    setSearchParams({ chapterId: String(chapterId) });
  }

  // 未购买：正文接口返回 3002
  if (
    contentQuery.error instanceof ApiError &&
    getErrorAction(contentQuery.error.code) === 'not-purchased'
  ) {
    return (
      <EmptyState
        description="购买后可学习"
        action={
          <Space>
            <Button type="primary" onClick={() => navigate(`/checkout/${courseId}`)}>
              去购买
            </Button>
            <Button onClick={() => navigate(`/courses/${courseId}`)}>查看课程详情</Button>
          </Space>
        }
      />
    );
  }

  if (courseQuery.isLoading || (validCourseId && !recordsReady && activeChapterId === null)) {
    return <Card loading />;
  }

  if (courseQuery.error || !courseQuery.data) {
    return (
      <EmptyState
        description="课程不存在或已下架"
        action={<Button onClick={() => navigate('/courses')}>返回课程列表</Button>}
      />
    );
  }

  // 已加载的课程详情
  const course = courseQuery.data;
  // 进度百分比：优先上报结果，其次学习记录
  const progressPercent = progress?.progressPercent ?? currentRecord?.progressPercent ?? 0;
  // 是否已学完
  const completed = progress?.completed ?? currentRecord?.completed ?? false;
  // 推荐位：排除当前课程，最多三条
  const recommendItems = (recommendationsQuery.data ?? [])
    .filter((item) => item.id !== courseId)
    .slice(0, 3);

  return (
    <div className="learning-page">
      <section className="learning-player-card">
        {contentQuery.isLoading ? (
          <Card loading />
        ) : contentQuery.data ? (
          <>
            {contentQuery.data.contentType === 'video' && (
              <div className="learning-player-head">
                <span className="learning-player-course">{course.name}</span>
                {currentChapter && (
                  <span className="learning-player-chapter">正在学习：{currentChapter.title}</span>
                )}
                {completed && <Tag color="green">已学完</Tag>}
              </div>
            )}
            <ChapterViewer
              content={contentQuery.data}
              courseName={course.name}
              chapterTitle={currentChapter?.title}
              coverUrl={course.coverUrl}
              onEnded={handleMediaEnded}
            />
          </>
        ) : contentQuery.error ? (
          <EmptyState description={contentQuery.error.message} />
        ) : (
          <EmptyState description="暂无章节" />
        )}
      </section>

      <div className="learning-body">
        <main className="learning-main">
          <Tabs
            defaultActiveKey="detail"
            className="learning-tabs"
            items={[
              {
                key: 'detail',
                label: '详情',
                children: (
                  <div className="learning-detail">
                    <h2 className="learning-section-title">课程概述</h2>
                    {course.intro && <Typography.Paragraph>{course.intro}</Typography.Paragraph>}
                    {course.detailRich && <RichTextViewer html={course.detailRich} />}
                    {!course.intro && !course.detailRich && (
                      <Typography.Text type="secondary">暂无介绍</Typography.Text>
                    )}
                  </div>
                ),
              },
              {
                key: 'chapters',
                label: '章节目录',
                children: (
                  <div className="learning-chapters">
                    <div className="learning-progress">
                      <span className="learning-progress-label">学习进度</span>
                      <Progress
                        percent={progressPercent}
                        className="learning-progress-bar"
                      />
                      {completed && <Tag color="green">已学完</Tag>}
                    </div>
                    {chapters.length === 0 ? (
                      <EmptyState description="暂无章节" />
                    ) : (
                      <ChapterNav
                        chapters={chapters}
                        activeChapterId={activeChapterId}
                        visitedChapterIds={visitedChapterIds}
                        onSelect={selectChapter}
                      />
                    )}
                  </div>
                ),
              },
            ]}
          />
        </main>

        {recommendItems.length > 0 && (
          <aside className="learning-side">
            <h2 className="learning-side-title">精品推荐</h2>
            <div className="learning-side-list">
              {recommendItems.map((item) => (
                <CourseMiniCard key={item.id} course={item} />
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
