import { List } from 'antd';
import type { ChapterBrief } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';

// 章节目录：仅展示名称与序号，未购用户不展示正文入口
export function CourseChapterList({ chapters }: { chapters: ChapterBrief[] }) {
  if (chapters.length === 0) {
    return <EmptyState description="课程章节准备中" />;
  }

  return (
    <List
      dataSource={chapters}
      renderItem={(chapter, index) => (
        <List.Item>
          {index + 1}. {chapter.title}
        </List.Item>
      )}
    />
  );
}
