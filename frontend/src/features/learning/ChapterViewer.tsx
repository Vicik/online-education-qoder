import { EmptyState } from '@/components/common/EmptyState';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import type { ChapterContent } from '@/api/types';

// 章节正文：图文用净化后的富文本；视频/音频用签名地址
export function ChapterViewer({ content }: { content: ChapterContent }) {
  // 正文为空：可能是签名未生成或后台尚未上传
  if (!content.content) {
    return <EmptyState description="章节内容暂未上传" />;
  }

  // 图文：后端已净化，前端再走一次白名单
  if (content.contentType === 'rich') {
    return <RichTextViewer html={content.content} />;
  }

  // 视频：key 随地址变化，切换章节时强制重建播放器
  if (content.contentType === 'video') {
    return (
      <video
        key={content.content}
        controls
        preload="metadata"
        style={{ width: '100%', maxHeight: 480 }}
        src={content.content}
      />
    );
  }

  // 音频：其余类型按音频处理
  return <audio controls style={{ width: '100%' }} src={content.content} />;
}
