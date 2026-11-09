import { DomUtils, ElementType, parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import sanitizeHtml from 'sanitize-html';

// 表格最大行列数：限制 HTML 表格的行数和列数，防止过大的表格影响性能
const MAX_TABLE_SIDE = 20;

// HTML 节点类型：从 parseDocument 返回的文档子节点类型
type HtmlNode = ReturnType<typeof parseDocument>['children'][number];
// HTML 元素类型：包含子节点的元素类型
type HtmlElement = Extract<HtmlNode, { children: HtmlNode[] }>;

// HTML 净化配置选项：定义允许的标签、属性和协议
const OPTIONS: sanitizeHtml.IOptions = {
  // 允许的 HTML 标签列表
  allowedTags: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'strong',
    'em',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'br',
    'blockquote',
    'code',
    'pre',
  ],
  // 各标签允许的属性
  allowedAttributes: {
    a: ['href', 'target', 'rel'], // 链接标签允许的属性
    img: ['src', 'alt', 'data-key'], // 图片标签允许的属性（data-key 用于读取时签名）
  },
  // 允许的 URL 协议
  allowedSchemes: ['http', 'https'],
  // 特定标签允许的 URL 协议
  allowedSchemesByTag: { img: ['http', 'https'] },
};

// 判断节点是否为指定标签名的元素
function isTag(node: HtmlNode, name: string): node is HtmlElement {
  return node.type === ElementType.Tag && node.name === name;
}

// 获取表格的直接行元素：只取属于本表格的行，遇到嵌套表格即停止
function rowsOf(table: HtmlElement): HtmlElement[] {
  // 行元素数组
  const rows: HtmlElement[] = [];
  // 递归遍历节点
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      // 跳过非标签节点
      if (node.type !== ElementType.Tag) continue;
      // 如果是 tr 标签，加入行数组
      if (node.name === 'tr') rows.push(node);
      // 如果不是嵌套的 table 标签，继续递归遍历
      else if (node.name !== 'table') walk(node.children);
    }
  };
  // 从表格的子节点开始遍历
  walk(table.children);
  // 返回所有行元素
  return rows;
}

// 截断过大的表格：限制表格的行数和列数，防止性能问题
function truncateTables(html: string): string {
  // 解析 HTML 为文档对象
  const document = parseDocument(html);
  // 获取所有表格元素
  const tables = DomUtils.getElementsByTagName(
    'table',
    document.children,
    true,
  );

  // 遍历每个表格进行截断处理
  for (const table of tables) {
    // 获取表格的所有行
    const rows = rowsOf(table);
    // 删除超出限制的多余行
    for (const row of rows.slice(MAX_TABLE_SIDE)) DomUtils.removeElement(row);
    // 处理保留的行，删除超出限制的单元格
    for (const row of rows.slice(0, MAX_TABLE_SIDE)) {
      // 获取行中的所有单元格（td 或 th）
      const cells = row.children.filter(
        (node) => isTag(node, 'td') || isTag(node, 'th'),
      );
      // 删除超出限制的多余单元格
      for (const cell of cells.slice(MAX_TABLE_SIDE))
        DomUtils.removeElement(cell);
    }
  }

  // 将修改后的文档对象渲染回 HTML 字符串
  return render(document, { encodeEntities: 'utf8' });
}

// 富文本 HTML 净化函数：清理 HTML 内容并限制表格大小，防止 XSS 和性能问题
export function sanitizeRichHtml(html: string): string {
  // 如果输入为空，返回空字符串
  if (!html) return '';
  // 先使用 sanitize-html 清理非法标签和属性，再截断过大的表格
  return truncateTables(sanitizeHtml(html, OPTIONS));
}
