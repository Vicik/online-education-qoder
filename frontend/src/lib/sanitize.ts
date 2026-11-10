import DOMPurify from 'dompurify';

// 富文本白名单：与后端净化规则保持一致
const RICH_TEXT_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'u', 's',
    'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'br', 'blockquote', 'code', 'pre',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'data-key', 'colspan', 'rowspan'],
};

// 展示端纵深防御：后端已净化，前端再过滤一次
export function sanitizeRichHtml(html: string): string {
  return DOMPurify.sanitize(html, RICH_TEXT_CONFIG);
}

// 表格截断：最多 maxRows 行、maxCols 列（与设计框架组件契约一致）
export function truncateRichTables(html: string, maxRows = 20, maxCols = 20): string {
  // 用游离文档解析，避免直接插入页面
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  documentNode.querySelectorAll('table').forEach((table) => {
    Array.from(table.querySelectorAll('tr'))
      .slice(maxRows)
      .forEach((row) => row.remove());
    Array.from(table.querySelectorAll('tr')).forEach((row) => {
      Array.from(row.children)
        .slice(maxCols)
        .forEach((cell) => cell.remove());
    });
  });
  return documentNode.body.innerHTML;
}

// 保存前序列化：表格截断 + 图片 src 回写为 key
export function serializeRichHtmlForSave(html: string): string {
  const documentNode = new DOMParser().parseFromString(truncateRichTables(html), 'text/html');
  documentNode.querySelectorAll('img[data-key]').forEach((image) => {
    const key = image.getAttribute('data-key');
    if (key) image.setAttribute('src', key);
  });
  return documentNode.body.innerHTML;
}
