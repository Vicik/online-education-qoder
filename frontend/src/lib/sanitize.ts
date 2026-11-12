import DOMPurify from 'dompurify';

// 富文本白名单：与后端净化规则保持一致
const RICH_TEXT_CONFIG = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'strong', 'em', 'u', 's',
    'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'br', 'hr', 'blockquote', 'code', 'pre',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'data-key', 'colspan', 'rowspan', 'style'],
};

// 允许的内联样式：与后端 allowedStyles 保持一致
const ALLOWED_STYLES: Record<string, RegExp[]> = {
  'text-align': [/^(left|center|right|justify)$/],
  color: [
    /^#[0-9a-f]{3,8}$/i,
    /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i,
    /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/i,
  ],
  'font-size': [/^\d{1,2}(\.\d+)?px$/],
  'line-height': [/^\d{1,2}(\.\d+)?$/],
};

// 允许携带内联样式的标签
const STYLE_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'LI', 'TD', 'TH', 'BLOCKQUOTE',
]);

// 过滤内联样式：DOMPurify 不校验 CSS，需再按白名单裁剪属性
function filterInlineStyles(html: string): string {
  // 用游离文档解析，避免影响页面
  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  documentNode.body.querySelectorAll('[style]').forEach((element) => {
    // 非排版标签直接移除 style
    if (!STYLE_TAGS.has(element.tagName)) {
      element.removeAttribute('style');
      return;
    }
    // jsdom 已把 style 解析为 CSSStyleDeclaration
    const style = (element as HTMLElement).style;
    // 保留的安全声明
    const declarations: string[] = [];
    for (const property of Array.from(style)) {
      // 属性的合法值正则
      const rules = ALLOWED_STYLES[property];
      // 当前值
      const value = style.getPropertyValue(property);
      if (rules?.some((rule) => rule.test(value))) {
        declarations.push(`${property}: ${value}`);
      }
    }
    if (declarations.length > 0) element.setAttribute('style', declarations.join('; '));
    else element.removeAttribute('style');
  });
  return documentNode.body.innerHTML;
}

// 展示端纵深防御：后端已净化，前端再过滤一次
export function sanitizeRichHtml(html: string): string {
  return filterInlineStyles(DOMPurify.sanitize(html, RICH_TEXT_CONFIG));
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
