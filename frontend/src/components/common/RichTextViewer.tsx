import { useMemo, useState } from 'react';
import { sanitizeRichHtml } from '@/lib/sanitize';
import { ImagePreview } from './ImagePreview';

// 展示中的预览图片：地址与替代文本
interface PreviewImage {
  src: string;
  alt: string;
}

// 富文本展示：后端已净化，前端再用白名单过滤一次；可追加展示层改写，图片点击弹窗预览
export function RichTextViewer({
  html,
  className,
  transform,
}: {
  html: string;
  className?: string;
  transform?: (cleanHtml: string) => string;
}) {
  // 当前预览的图片，null 表示未打开
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  // 净化结果按原文缓存，避免每次渲染重复过滤
  const cleanHtml = useMemo(() => {
    // 白名单过滤后的安全 HTML
    const clean = sanitizeRichHtml(html);
    return transform ? transform(clean) : clean;
  }, [html, transform]);

  // 点击正文图片：在当前页弹窗预览
  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    // 命中的图片元素
    const image = (event.target as HTMLElement).closest('img');
    if (!image) return;
    setPreview({
      src: image.currentSrc || image.src,
      alt: image.alt || '图片预览',
    });
  }

  return (
    <>
      <div
        className={className ? `rich-text-viewer ${className}` : 'rich-text-viewer'}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: cleanHtml }}
      />
      <ImagePreview
        src={preview?.src ?? null}
        alt={preview?.alt}
        onClose={() => setPreview(null)}
      />
    </>
  );
}
