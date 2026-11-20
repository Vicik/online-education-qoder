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
import { listMyOrders } from '@/api/trade';
import type { ChapterBrief } from '@/api/types';
import { buildLoginRedirect } from '@/app/login-redirect';
import { CourseMiniCard } from '@/components/common/CourseMiniCard';
import { EmptyState } from '@/components/common/EmptyState';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { useSessionStore } from '@/stores/session';
import { ChapterNav } from './ChapterNav';
import { ChapterViewer } from './ChapterViewer';
import './LearningPage.css';

// 初始章节：URL 指定优先（即使锁定），其次可访问的最近章节，再次第一个可访问章节，最后第一章
export function resolveInitialChapterId(
  chapters: ChapterBrief[],
  requestedChapterId: number | null,
  lastChapterId: number | null | undefined,
  isAccessible: (chapter: ChapterBrief) => boolean,
  ready = true,
): number | null {
  // 访问判定未就绪时保持空，由页面展示加载态
  if (!ready) return null;
  // URL 指定且属于本课程：锁定也保留，用于展示锁定态
  if (
    requestedChapterId !== null &&
    chapters.some((chapter) => chapter.id === requestedChapterId)
  ) {
    return requestedChapterId;
  }
  // 学习记录的最近章节：仅在可访问时恢复
  if (
    lastChapterId != null &&
    chapters.some(
      (chapter) => chapter.id === lastChapterId && isAccessible(chapter),
    )
  ) {
    return lastChapterId;
  }
  // 第一个可访问章节
  const firstOpen = chapters.find(isAccessible);
  if (firstOpen) return firstOpen.id ?? null;
  // 兜底第一章：无开放章节时展示锁定引导
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
  // 当前会话用户：游客可看免费章节
  const user = useSessionStore((state) => state.user);
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
  // 学习记录：仅登录用户查询并用于恢复最近章节
  const recordsQuery = useQuery({
    queryKey: queryKeys.studyRecords(1),
    queryFn: () => listStudyRecords(1, 100),
    enabled: validCourseId && Boolean(user),
  });
  // 我的订单：登录后判断当前课程是否已购
  const ordersQuery = useQuery({
    queryKey: queryKeys.myOrdersAll,
    queryFn: () => listMyOrders(1, 100),
    enabled: validCourseId && Boolean(user),
    retry: false,
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

  // 章节列表（稳定引用）
  const chapters = useMemo(() => courseQuery.data?.chapters ?? [], [courseQuery.data]);
  // 是否免费课程
  const courseFree = (courseQuery.data?.saleCents ?? 0) === 0;
  // 是否已购当前课程
  const purchased = Boolean(
    ordersQuery.data?.items.some(
      (order) => order.courseId === courseId && order.status === 'paid',
    ),
  );
  // 章节是否开放：免费课程/试看章节/已购
  function chapterOpen(chapter: ChapterBrief | undefined): boolean {
    if (!chapter) return false;
    return courseFree || chapter.isFree === true || purchased;
  }
  // 学习记录就绪：URL 指定、游客或记录已返回
  const recordsReady = requestedChapterId !== null || !user || recordsQuery.isFetched;
  // 订单就绪：游客直接视为就绪，登录用户等订单返回
  const accessReady = !user || ordersQuery.isFetched;
  // 访问判定总就绪
  const viewerReady = recordsReady && accessReady;
  // 当前章节 id
  const activeChapterId = resolveInitialChapterId(
    chapters,
    requestedChapterId,
    lastChapterId,
    chapterOpen,
    viewerReady,
  );
  // 当前章节
  const currentChapter = chapters.find((chapter) => chapter.id === activeChapterId);
  // 购买引导目标：优先进行中的秒杀，其次拼团，最后结算页
  const purchaseTarget = courseQuery.data?.flashSale?.id
    ? `/flash-sales/${courseQuery.data.flashSale.id}`
    : courseQuery.data?.groupon?.id
      ? `/groupons/${courseQuery.data.groupon.id}`
      : `/checkout/${courseId}`;

  // 当前章节正文：锁定章节不发请求
  const contentQuery = useQuery({
    queryKey: queryKeys.courseContent(courseId, activeChapterId ?? 0),
    queryFn: () => getChapterContent(courseId, activeChapterId as number),
    enabled:
      activeChapterId !== null &&
      viewerReady &&
      validCourseId &&
      chapterOpen(currentChapter),
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

  // 播放结束：仅登录且章节开放时上报；游客与锁定章节不上报
  function handleMediaEnded() {
    if (!user || activeChapterId === null || !chapterOpen(currentChapter)) return;
    if (reportedChapterRef.current.has(activeChapterId)) return;
    reportedChapterRef.current.add(activeChapterId);
    reportVisit(activeChapterId);
  }

  // 切换章节：写入 URL，刷新后保持
  function selectChapter(chapterId: number): void {
    setSearchParams({ chapterId: String(chapterId) });
  }

  // 等课程与访问判定就绪再渲染，避免锁定态与内容态闪烁
  if (
    courseQuery.isLoading ||
    (validCourseId && !viewerReady && activeChapterId === null)
  ) {
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
  // 是否锁定当前章节：可交互且未开放
  const currentLocked =
    activeChapterId !== null &&
    currentChapter !== undefined &&
    !chapterOpen(currentChapter);

  return (
    <div className="learning-page">
      <section className="learning-player-card">
        {currentLocked ? (
          <EmptyState
            description={user ? '购买后可学习' : '登录后可学习'}
            action={
              <Space>
                {user ? (
                  <Button type="primary" onClick={() => navigate(purchaseTarget)}>
                    去购买
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    onClick={() =>
                      navigate(
                        buildLoginRedirect(
                          `/learning/${courseId}?chapterId=${activeChapterId}`,
                          false,
                        ),
                      )
                    }
                  >
                    去登录
                  </Button>
                )}
                <Button onClick={() => navigate(`/courses/${courseId}`)}>
                  查看课程详情
                </Button>
              </Space>
            }
          />
        ) : contentQuery.isLoading ? (
          <Card loading />
        ) : contentQuery.data ? (
          <>
            {contentQuery.data.contentType === 'video' && (
              <div className="learning-player-head">
                <span className="learning-player-course">{course.name}</span>
                {currentChapter && (
                  <span className="learning-player-chapter">
                    正在学习：{currentChapter.title}
                  </span>
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
          contentQuery.error instanceof ApiError &&
          getErrorAction(contentQuery.error.code) === 'not-purchased' ? (
            <EmptyState
              description={user ? '购买后可学习' : '登录后可学习'}
              action={
                <Space>
                  <Button
                    type="primary"
                    onClick={() =>
                      user
                        ? navigate(purchaseTarget)
                        : navigate(
                            buildLoginRedirect(
                              `/learning/${courseId}?chapterId=${activeChapterId}`,
                              false,
                            ),
                          )
                    }
                  >
                    {user ? '去购买' : '去登录'}
                  </Button>
                  <Button onClick={() => navigate(`/courses/${courseId}`)}>
                    查看课程详情
                  </Button>
                </Space>
              }
            />
          ) : (
            <EmptyState description={contentQuery.error.message} />
          )
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
                        courseFree={courseFree}
                        purchased={purchased}
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
