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

// 保存前把已签名的 img src 回写为对象存储 key（保留 data-key）
export function serializeRichHtmlForSave(html: string): string {
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  documentNode.querySelectorAll('img[data-key]').forEach((image) => {
    const key = image.getAttribute('data-key');
    if (key) image.setAttribute('src', key);
  });
  return documentNode.body.innerHTML;
}
