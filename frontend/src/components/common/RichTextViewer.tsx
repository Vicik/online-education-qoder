import { useMemo } from 'react';
import { sanitizeRichHtml } from '@/lib/sanitize';

// 富文本展示：后端已净化，前端再用白名单过滤一次
export function RichTextViewer({ html, className }: { html: string; className?: string }) {
  // 净化结果按原文缓存，避免每次渲染重复过滤
  const cleanHtml = useMemo(() => sanitizeRichHtml(html), [html]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
}
