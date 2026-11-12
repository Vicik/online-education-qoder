import { DomUtils, parseDocument } from 'htmlparser2';
import render from 'dom-serializer';

// 存储 key 最大长度：防御异常超长字符串
const MAX_KEY_LENGTH = 512;
// 存储 key 允许的字符：字母数字开头，随后可含字母数字、点、下划线、斜杠、连字符
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

// 判断字符串是否为本地存储 key（排除 http(s)、协议相对、绝对路径与各类 scheme）
export function isStorageKey(value: unknown): value is string {
  // 仅接受字符串
  if (typeof value !== 'string') return false;
  // 空串与超长串直接拒绝
  if (!value || value.length > MAX_KEY_LENGTH) return false;
  // 字符集白名单：冒号、空格、引号等均被排除
  if (!STORAGE_KEY_PATTERN.test(value)) return false;
  // 拒绝协议相对与空路径段
  if (value.includes('//')) return false;
  // 拒绝路径穿越
  return !value.split('/').includes('..');
}

// 解析 HTML 并返回全部 img 元素
function imageElements(html: string) {
  return DomUtils.getElementsByTagName(
    'img',
    parseDocument(html).children,
    true,
  );
}

// 收集富文本图片的存储 key：优先 data-key，缺失时回退到 key 形式的 src
export function collectImageKeys(html: string): string[] {
  // 输入为空时无需解析
  if (!html) return [];
  // 去重并保持出现顺序
  const keys = new Set<string>();
  for (const img of imageElements(html)) {
    // data-key 为约定字段，优先使用
    const dataKey = img.attribs['data-key'];
    if (isStorageKey(dataKey)) {
      keys.add(dataKey);
      continue;
    }
    // 兼容仅把 key 写在 src 的历史内容
    if (isStorageKey(img.attribs.src)) keys.add(img.attribs.src);
  }
  return [...keys];
}

// 将富文本图片的 src 重写为解析后的地址：保留 data-key，历史 http(s) 地址原样保留
export function applyImageUrls(
  html: string,
  urls: ReadonlyMap<string, string>,
): string {
  // 输入为空时直接返回
  if (!html) return '';
  // 解析文档后原地修改 img 属性
  const document = parseDocument(html);
  // 是否有节点被改写：无改写时原样返回，避免序列化改变原始写法
  let changed = false;

  for (const img of DomUtils.getElementsByTagName(
    'img',
    document.children,
    true,
  )) {
    // data-key 为约定字段，非 key 时回退到 src
    const dataKey = img.attribs['data-key'];
    const key = isStorageKey(dataKey)
      ? dataKey
      : isStorageKey(img.attribs.src)
        ? img.attribs.src
        : null;
    // 未收集到解析地址时保持原状
    const signed = key === null ? undefined : urls.get(key);
    if (signed === undefined) continue;
    // 仅改写 src，data-key 保留给前端回写
    img.attribs.src = signed;
    changed = true;
  }

  // 无改写时返回原始字符串
  if (!changed) return html;
  // 序列化回 HTML
  return render(document, { encodeEntities: 'utf8' });
}
