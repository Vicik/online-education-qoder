// 块级内容标签：保持原有结构，不额外包段落
const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'PRE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'FIGURE',
  'TABLE',
  'HR',
]);

// 信息流正文摘要的最大字数
export const POST_PREVIEW_LENGTH = 100;

// 递归收集文本：块级节点与换行两侧补空格，避免段落粘连
function collectText(node: Node, parts: string[]): void {
  // 文本节点直接记录
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.textContent ?? '');
    return;
  }
  // 非元素节点（注释等）忽略
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  // 当前元素
  const element = node as Element;
  // 换行处补空格，保持行与行的间距
  if (element.tagName === 'BR') {
    parts.push(' ');
    return;
  }
  // 图片不贡献文字
  if (element.tagName === 'IMG') return;
  // 块级标签（含列表项）前后补空格，保持段落边界
  const isBlock = BLOCK_TAGS.has(element.tagName) || element.tagName === 'LI';
  if (isBlock) parts.push(' ');
  // 子节点文本
  for (const child of Array.from(element.childNodes)) collectText(child, parts);
  if (isBlock) parts.push(' ');
}

// 正文纯文本：合并空白后的可读文字
export function postPlainText(html: string): string {
  // 解析后的正文根节点
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body
    .firstElementChild;
  if (!root) return '';
  // 文本片段
  const parts: string[] = [];
  collectText(root, parts);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

// 信息流摘要：正文只保留前 100 字，图片按原顺序保留
export function truncatePostHtml(html: string): string {
  // 解析后的正文根节点
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body
    .firstElementChild;
  if (!root) return html;
  // 合并空白后的全文
  const text = postPlainText(html);
  // 摘要文本：超出上限补省略号
  const brief =
    text.length > POST_PREVIEW_LENGTH ? `${text.slice(0, POST_PREVIEW_LENGTH)}…` : text;
  // 摘要容器
  const container = document.createElement('div');
  if (brief) {
    // 摘要段落
    const paragraph = document.createElement('p');
    paragraph.textContent = brief;
    container.appendChild(paragraph);
  }
  // 正文图片：复制可见属性，交给规范化步骤归入图集
  for (const image of Array.from(root.querySelectorAll('img'))) {
    // 图片副本
    const clone = document.createElement('img');
    clone.setAttribute('src', image.getAttribute('src') ?? '');
    clone.setAttribute('alt', image.getAttribute('alt') ?? '');
    // 保留上传图片的原始 key，便于后续溯源
    const key = image.getAttribute('data-key');
    if (key) clone.setAttribute('data-key', key);
    container.appendChild(clone);
  }
  return container.innerHTML;
}

// 规范化正文：松散行内节点包成段落，连续图片归入图集容器
export function normalizePostHtml(html: string): string {
  // 解析后的正文根节点
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  if (!root) return html;

  // 规范化后的容器
  const container = document.createElement('div');
  // 当前图集：连续图片共享一个容器
  let gallery: HTMLDivElement | null = null;
  // 当前段落：收集松散行内节点
  let paragraph: HTMLParagraphElement | null = null;

  // 按文档顺序重组子节点
  for (const node of Array.from(root.childNodes)) {
    // 图片：进入图集，遇到文本或块级节点才结束
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'IMG') {
      paragraph = null;
      if (!gallery) {
        gallery = document.createElement('div');
        gallery.className = 'community-post-gallery';
        container.appendChild(gallery);
      }
      gallery.appendChild(node);
      continue;
    }
    gallery = null;
    // 纯空白文本不单独成段
    if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()) continue;
    // 块级节点保持原样
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      BLOCK_TAGS.has((node as Element).tagName)
    ) {
      paragraph = null;
      container.appendChild(node);
      continue;
    }
    // 松散行内节点：同一行内容合并进一个段落
    if (!paragraph) {
      paragraph = document.createElement('p');
      container.appendChild(paragraph);
    }
    paragraph.appendChild(node);
  }

  return container.innerHTML;
}
