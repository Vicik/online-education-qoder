import { Button, Card, Col, Progress, Row, Space, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { getCourseDetail } from '@/api/catalog';
import { ApiError, getErrorAction } from '@/api/errors';
import {
  getChapterContent,
  listStudyRecords,
  recordChapterVisit,
  type LearningProgress,
} from '@/api/learning';
import { queryKeys } from '@/api/query-keys';
import type { ChapterBrief } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';
import { ChapterNav } from './ChapterNav';
import { ChapterViewer } from './ChapterViewer';

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

// 学习页：左侧章节导航 + 右侧正文，打开即上报访问
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
  // QueryClient：访问成功后失效学习记录
  const queryClient = useQueryClient();
  // 已访问章节（本地即时标记）
  const [visitedChapterIds, setVisitedChapterIds] = useState<Set<number>>(() => new Set());
  // 最近一次上报返回的进度
  const [progress, setProgress] = useState<LearningProgress | null>(null);
  // 已上报的章节 id，防止同一章节重复上报
  const reportedChapterRef = useRef<number | null>(null);

  // 课程详情（章节名与标题）
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

  // 本课程的学习记录
  const currentRecord = recordsQuery.data?.items.find((item) => item.courseId === courseId);
  // 最近学习章节
  const lastChapterId = currentRecord?.lastChapterId;

  // 无 URL 指定章节时，等学习记录就绪再定初始章节，避免先打开第一章再跳走导致重复上报
  const recordsReady = requestedChapterId !== null || recordsQuery.isFetched;

  // 章节列表（稳定引用）
  const chapters = useMemo(() => courseQuery.data?.chapters ?? [], [courseQuery.data]);

  // 当前章节 id
  const activeChapterId = resolveInitialChapterId(chapters, requestedChapterId, lastChapterId);

  // 当前章节正文
  const contentQuery = useQuery({
    queryKey: queryKeys.courseContent(courseId, activeChapterId ?? 0),
    queryFn: () => getChapterContent(courseId, activeChapterId as number),
    enabled: activeChapterId !== null && recordsReady && validCourseId,
    retry: false,
  });

  // 上报访问：成功后更新进度并标记已学
  const { mutate: reportVisit } = useMutation({
    mutationFn: (chapterId: number) => recordChapterVisit(courseId, chapterId),
    onSuccess: (result, chapterId) => {
      setProgress(result);
      setVisitedChapterIds((previous) => new Set(previous).add(chapterId));
      queryClient.invalidateQueries({ queryKey: queryKeys.studyRecordsRoot });
    },
  });

  // 正文加载成功后上报一次（同一章节只报一次）
  useEffect(() => {
    if (!contentQuery.data || activeChapterId === null) return;
    if (reportedChapterRef.current === activeChapterId) return;
    reportedChapterRef.current = activeChapterId;
    reportVisit(activeChapterId);
  }, [contentQuery.data, activeChapterId, reportVisit]);

  // 切换章节：写入 URL，刷新后保持
  function selectChapter(chapterId: number): void {
    setSearchParams({ chapterId: String(chapterId) });
  }

  // 相对当前章节切换（-1 上一章，1 下一章）
  function selectRelative(offset: number): void {
    // 目标章节（可能是越界或缺少 id）
    const target = chapters[activeIndex + offset];
    if (target?.id !== undefined) selectChapter(target.id);
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

  // 进度百分比：优先上报结果，其次学习记录
  const progressPercent = progress?.progressPercent ?? currentRecord?.progressPercent ?? 0;
  // 是否已学完
  const completed = progress?.completed ?? currentRecord?.completed ?? false;
  // 当前章节索引
  const activeIndex = chapters.findIndex((chapter) => chapter.id === activeChapterId);

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={4}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {courseQuery.data.name}
          </Typography.Title>
          <Space>
            <Progress percent={progressPercent} style={{ width: 240 }} />
            {completed && <Tag color="green">已学完</Tag>}
          </Space>
        </Space>
      </Card>

      <Row gutter={16}>
        <Col flex="240px">
          <Card title="章节目录" styles={{ body: { padding: 0 } }}>
            <ChapterNav
              chapters={chapters}
              activeChapterId={activeChapterId}
              visitedChapterIds={visitedChapterIds}
              onSelect={selectChapter}
            />
          </Card>
        </Col>
        <Col flex="auto">
          <Card
            title={chapters.find((chapter) => chapter.id === activeChapterId)?.title}
            extra={
              <Space>
                <Button disabled={activeIndex <= 0} onClick={() => selectRelative(-1)}>
                  上一章
                </Button>
                <Button
                  disabled={activeIndex < 0 || activeIndex >= chapters.length - 1}
                  onClick={() => selectRelative(1)}
                >
                  下一章
                </Button>
              </Space>
            }
          >
            {contentQuery.isLoading ? (
              <Card loading />
            ) : contentQuery.data ? (
              <ChapterViewer content={contentQuery.data} />
            ) : contentQuery.error ? (
              <EmptyState description={contentQuery.error.message} />
            ) : (
              <EmptyState description="暂无章节" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
