import { LockOutlined } from '@ant-design/icons';
import { List, Tag } from 'antd';
import type { ChapterBrief } from '@/api/types';

// 章节导航：点击切换，展示试看/锁定/已学状态
export function ChapterNav({
  chapters,
  activeChapterId,
  visitedChapterIds,
  courseFree = false,
  purchased = false,
  onSelect,
}: {
  // 章节目录（不含正文）
  chapters: ChapterBrief[];
  // 当前打开的章节 id
  activeChapterId: number | null;
  // 本次会话已上报访问的章节
  visitedChapterIds: Set<number>;
  // 是否免费课程：全部章节开放
  courseFree?: boolean;
  // 是否已购：全部章节开放
  purchased?: boolean;
  // 选择章节回调
  onSelect: (chapterId: number) => void;
}) {
  return (
    <List
      dataSource={chapters}
      renderItem={(chapter, index) => {
        // 后端如返回 visited 则以其为准，否则用本地已访问集合
        const visited =
          chapter.visited === true ||
          (chapter.id !== undefined && visitedChapterIds.has(chapter.id));
        // 是否试看章节
        const isTrial = courseFree || chapter.isFree === true;
        // 是否开放
        const open = isTrial || purchased;
        return (
          <List.Item
            style={{
              cursor: 'pointer',
              paddingInline: 12,
              background: chapter.id === activeChapterId ? '#e6f4ff' : undefined,
            }}
            onClick={() => {
              // OpenAPI 中 id 可选，缺省项不可点击
              if (chapter.id !== undefined) onSelect(chapter.id);
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <span>
                {index + 1}. {chapter.title}
              </span>
              <span>
                {isTrial && <Tag color="blue">试看</Tag>}
                {!open && (
                  <Tag icon={<LockOutlined />} color="default">
                    购买后学习
                  </Tag>
                )}
                {visited && <Tag color="green">已学</Tag>}
              </span>
            </div>
          </List.Item>
        );
      }}
    />
  );
}
