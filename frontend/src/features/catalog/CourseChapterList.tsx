import { LockOutlined } from '@ant-design/icons';
import { List, Tag } from 'antd';
import type { ChapterBrief } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';

// 章节目录：展示试看/锁定状态，可交互时点击进入学习页
export function CourseChapterList({
  chapters,
  courseFree = false,
  purchased = false,
  accessReady = true,
  onSelect,
}: {
  // 章节目录（不含正文）
  chapters: ChapterBrief[];
  // 课程 id：可交互模式下用于展示，实际跳转由 onSelect 负责
  courseId?: number;
  // 是否免费课程：全部章节开放
  courseFree?: boolean;
  // 是否已购：已购全部章节开放
  purchased?: boolean;
  // 访问判定是否就绪：登录用户等待订单查询，避免锁定态闪烁
  accessReady?: boolean;
  // 章节点击回调；缺省表示只读（活动详情、管理端预览）
  onSelect?: (chapterId: number) => void;
}) {
  if (chapters.length === 0) {
    return <EmptyState description="课程章节准备中" />;
  }

  // 是否可交互：只读场景不展示锁定态与点击
  const interactive = onSelect !== undefined;

  return (
    <List
      dataSource={chapters}
      renderItem={(chapter, index) => {
        // 是否试看：免费课程或章节标记
        const isTrial = courseFree || chapter.isFree === true;
        // 是否已开放：免费课程/试看章节/已购
        const open = isTrial || purchased;
        // 锁定态：仅可交互且访问判定就绪时展示
        const locked = interactive && accessReady && !open;
        return (
          <List.Item
            style={{ cursor: interactive ? 'pointer' : undefined }}
            onClick={() => {
              if (!interactive || !accessReady || chapter.id === undefined) return;
              onSelect(chapter.id);
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <span>
                {index + 1}. {chapter.title}
              </span>
              <span>
                {isTrial && <Tag color="blue">试看</Tag>}
                {locked && (
                  <Tag icon={<LockOutlined />} color="default">
                    购买后学习
                  </Tag>
                )}
              </span>
            </div>
          </List.Item>
        );
      }}
    />
  );
}
