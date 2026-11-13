import { EmptyState } from '@/components/common/EmptyState';
import type { ChapterContent } from '@/api/types';
import { AudioPlayer } from './AudioPlayer';

// 章节播放器：视频用原生播放器；音频用自定义窄条；播放结束回调
export function ChapterViewer({
  content,
  courseName,
  chapterTitle,
  coverUrl,
  onEnded,
}: {
  // 章节正文（签名地址）
  content: ChapterContent;
  // 课程名称：音频条主标题
  courseName?: string;
  // 当前章节名称：音频条副标题
  chapterTitle?: string;
  // 课程封面：音频条缩略图
  coverUrl?: string | null;
  // 播放到结尾时回调
  onEnded?: () => void;
}) {
  // 正文为空：可能是签名未生成或后台尚未上传
  if (!content.content) {
    return <EmptyState description="章节内容暂未上传" />;
  }

  // 视频：key 随地址变化，切换章节时强制重建播放器
  if (content.contentType === 'video') {
    return (
      <video
        key={content.content}
        className="learning-video-player"
        controls
        preload="metadata"
        src={content.content}
        onEnded={onEnded}
      />
    );
  }

  // 音频：自定义窄条，隐藏 audio 元素驱动进度
  return (
    <AudioPlayer
      key={content.content}
      src={content.content}
      coverUrl={coverUrl}
      title={courseName ?? content.title ?? '音频课程'}
      subtitle={chapterTitle}
      onEnded={onEnded}
    />
  );
}
