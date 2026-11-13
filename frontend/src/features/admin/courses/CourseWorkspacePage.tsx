import { useState } from 'react';
import { App as AntdApp, Button, Card, Modal, Segmented, Space, Tooltip } from 'antd';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdminCourse, publishCourse, unpublishCourse } from '@/api/admin/courses';
import type { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { CourseWriteResult } from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { BasicInfoForm } from './BasicInfoForm';
import { ChapterPanel } from './ChapterPanel';

// 工作区两步：基本信息 / 章节维护
type Step = 'basics' | 'chapters';

// 步骤选项
const STEP_OPTIONS = [
  { label: '基本信息', value: 'basics' },
  { label: '章节维护', value: 'chapters' },
];

// 课程工作区：两步互斥切换、发布/下架与版本冲突刷新
export default function CourseWorkspacePage() {
  // 路由参数
  const params = useParams<{ id: string }>();
  // 课程 id
  const courseId = Number(params.id);
  // 路由跳转
  const navigate = useNavigate();
  // URL 查询参数：保存当前步骤，刷新后保持
  const [searchParams, setSearchParams] = useSearchParams();
  // 当前步骤
  const step: Step = searchParams.get('step') === 'chapters' ? 'chapters' : 'basics';
  // AntD 消息与确认框
  const { message } = AntdApp.useApp();
  // Query 缓存
  const queryClient = useQueryClient();
  // 版本冲突提示是否打开
  const [conflictOpen, setConflictOpen] = useState(false);

  // 课程详情查询
  const query = useQuery({
    queryKey: queryKeys.adminCourse(courseId),
    queryFn: () => getAdminCourse(courseId),
    enabled: Number.isInteger(courseId) && courseId > 0,
  });

  // 重取详情并刷新管理端课程缓存
  async function refreshCourse() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'courses'] });
  }

  // 版本冲突：只提示刷新，不自动覆盖
  function handleConflict() {
    setConflictOpen(true);
  }

  // 刷新最新数据并关闭冲突提示
  async function refreshAfterConflict() {
    setConflictOpen(false);
    await refreshCourse();
  }

  // 发布：确认后调用；冲突交给刷新弹窗，其余错误由确认框提示
  const publishMutation = useMutation<CourseWriteResult, ApiError, void>({
    mutationFn: () => publishCourse(courseId),
    onSuccess: async () => {
      await refreshCourse();
      message.success('课程已发布');
    },
  });

  // 下架
  const unpublishMutation = useMutation<CourseWriteResult, ApiError, void>({
    mutationFn: () => unpublishCourse(courseId),
    onSuccess: async () => {
      await refreshCourse();
      message.success('课程已下架');
    },
  });

  // 打开确认框并调用发布/下架；409 转为刷新提示
  async function confirmStatusChange(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      if ((error as ApiError).status === 409) {
        handleConflict();
        return;
      }
      throw error;
    }
  }

  if (query.isLoading) return <Card loading />;
  if (query.error || !query.data) {
    return (
      <EmptyState
        description="课程不存在"
        action={
          <Button onClick={() => navigate('/admin/courses')}>返回课程列表</Button>
        }
      />
    );
  }

  // 当前课程详情
  const course = query.data;
  // 章节数：章节数组优先，兼容仅返回计数的接口
  const chapterCount = course.chapters?.length ?? course.chapterCount ?? 0;
  // 无章节课程不可发布：按钮禁用并提示先加章节
  const publishDisabled = chapterCount === 0;

  return (
    <div>
      <PageHeader
        title={course.name}
        extra={
          <Space>
            {(course.status === 'draft' || course.status === 'unpublished') &&
              (publishDisabled ? (
                // 无章节不可发布：禁用按钮并在悬浮时说明原因
                <Tooltip title="请先添加至少一个章节，再发布课程">
                  <span style={{ cursor: 'not-allowed' }}>
                    <Button type="primary" autoInsertSpace={false} disabled>
                      发布
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <ConfirmAction
                  title="发布课程"
                  content="发布后课程对用户可见，确认发布？"
                  onConfirm={() =>
                    confirmStatusChange(() => publishMutation.mutateAsync())
                  }
                >
                  <Button type="primary" autoInsertSpace={false}>
                    发布
                  </Button>
                </ConfirmAction>
              ))}
            {course.status === 'published' && (
              <ConfirmAction
                title="下架课程"
                content="下架后用户不可新购买，已购用户仍可学习，确认下架？"
                danger
                onConfirm={() =>
                  confirmStatusChange(() => unpublishMutation.mutateAsync())
                }
              >
                <Button danger autoInsertSpace={false}>
                  下架
                </Button>
              </ConfirmAction>
            )}
            <Button onClick={() => navigate('/admin/courses')}>返回列表</Button>
          </Space>
        }
      />

      <Segmented
        options={STEP_OPTIONS}
        value={step}
        onChange={(value) => setSearchParams({ step: String(value) })}
        style={{ marginBottom: 16 }}
      />

      <Card>
        {step === 'basics' ? (
          <BasicInfoForm
            key={course.version ?? 0}
            course={course}
            onSaved={refreshCourse}
            onConflict={handleConflict}
          />
        ) : (
          <ChapterPanel
            course={course}
            onChanged={refreshCourse}
            onConflict={handleConflict}
          />
        )}
      </Card>

      <Modal
        title="内容已在其他页面被修改，请刷新后重试"
        open={conflictOpen}
        okText="刷新"
        cancelText="关闭"
        okButtonProps={{ autoInsertSpace: false }}
        cancelButtonProps={{ autoInsertSpace: false }}
        onOk={() => void refreshAfterConflict()}
        onCancel={() => setConflictOpen(false)}
      >
        刷新将载入最新数据，本次未保存的修改会丢失。
      </Modal>
    </div>
  );
}
