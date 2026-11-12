import { sanitizeRichHtml } from './sanitize.util';

function countTags(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length;
}

describe('sanitizeRichHtml', () => {
  it('剥离 script 与事件属性', () => {
    expect(
      sanitizeRichHtml('<p onclick="x()">a</p><script>alert(1)</script>'),
    ).toBe('<p>a</p>');
  });

  it('保留白名单标签', () => {
    const html =
      '<h1>a</h1><h2>b</h2><h3>c</h3><h4>d</h4><h5>e</h5><h6>f</h6>' +
      '<p><strong>g</strong><em>h</em><u>i</u><s>j</s></p>' +
      '<ul><li>k</li></ul><ol><li>l</li></ol>' +
      '<blockquote>m</blockquote><pre><code>n</code></pre><p>o<br />p</p>' +
      '<table><thead><tr><th>q</th></tr></thead><tbody><tr><td>r</td></tr></tbody></table>';
    const out = sanitizeRichHtml(html);

    for (const tag of [
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
      'blockquote',
      'pre',
      'code',
      'br',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ]) {
      expect(out).toContain(`<${tag}`);
    }
  });

  it('剥离别白名单外标签', () => {
    const out = sanitizeRichHtml(
      '<div><iframe src="http://evil"></iframe><p>a</p></div>',
    );
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('<div');
    expect(out).toContain('<p>a</p>');
  });

  it('链接仅允许 http/https', () => {
    expect(
      sanitizeRichHtml('<a href="javascript:alert(1)">x</a>'),
    ).not.toContain('javascript:');
    expect(
      sanitizeRichHtml('<a href="https://a.test" rel="noopener">x</a>'),
    ).toContain('href="https://a.test"');
  });

  it('图片 src 仅允许 http/https，且保留 alt', () => {
    const out = sanitizeRichHtml(
      '<img src="javascript:alert(1)" alt="a" onerror="x()" />',
    );
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('onerror');
    expect(
      sanitizeRichHtml('<img src="https://a.test/a.png" alt="图" />'),
    ).toContain('alt="图"');
  });

  it('图片保留 data-key，其余 data-* 属性剥离', () => {
    const out = sanitizeRichHtml(
      '<img src="zhixu/2026/11/a.png" data-key="zhixu/2026/11/a.png" data-x="1" alt="图" />',
    );
    expect(out).toContain('data-key="zhixu/2026/11/a.png"');
    expect(out).toContain('src="zhixu/2026/11/a.png"');
    expect(out).not.toContain('data-x');
  });

  it('表格超过 20 行时截断到 20', () => {
    const html = '<table>' + '<tr><td>x</td></tr>'.repeat(25) + '</table>';
    const out = sanitizeRichHtml(html);
    expect(countTags(out, 'tr')).toBe(20);
  });

  it('表格超过 20 列时截断到 20', () => {
    const html = '<table><tr>' + '<td>x</td>'.repeat(25) + '</tr></table>';
    const out = sanitizeRichHtml(html);
    expect(countTags(out, 'td')).toBe(20);
  });

  it('截断后表格结构仍然闭合', () => {
    const html =
      '<table><tbody>' +
      '<tr>' +
      '<td>x</td>'.repeat(30) +
      '</tr>'.repeat(1) +
      '</tbody></table>';
    const out = sanitizeRichHtml(html);
    expect(countTags(out, 'table')).toBe(1);
    expect(out).toContain('</table>');
    expect(countTags(out, 'td')).toBe(20);
  });

  it('thead 与 tbody 的行合并计入 20 行上限', () => {
    const html =
      '<table><thead><tr><th>h</th></tr></thead><tbody>' +
      '<tr><td>x</td></tr>'.repeat(25) +
      '</tbody></table>';
    expect(countTags(sanitizeRichHtml(html), 'tr')).toBe(20);
  });

  it('恰好 20 行 20 列不被截断', () => {
    const html =
      '<table>' +
      ('<tr>' + '<td>x</td>'.repeat(20) + '</tr>').repeat(20) +
      '</table>';
    const out = sanitizeRichHtml(html);
    expect(countTags(out, 'tr')).toBe(20);
    expect(countTags(out, 'td')).toBe(400);
  });

  it('嵌套表格各算各的额度，内层行不吃外层配额', () => {
    const inner = '<table>' + '<tr><td>i</td></tr>'.repeat(25) + '</table>';
    const html =
      '<table>' + `<tr><td>${inner}</td></tr>`.repeat(3) + '</table>';
    const out = sanitizeRichHtml(html);
    expect(countTags(out, 'table')).toBe(4);
    expect(countTags(out, 'tr')).toBe(63);
  });

  it('保留文本对齐、颜色、字号与行距', () => {
    const html =
      '<h2 style="text-align: center; color: #0958d9">标题</h2>' +
      '<p style="line-height: 1.75"><span style="font-size: 18px; color: rgb(9, 88, 217)">正文</span></p>';
    const out = sanitizeRichHtml(html);
    expect(out).toMatch(/text-align\s*:\s*center/);
    expect(out).toMatch(/color\s*:\s*#0958d9/);
    expect(out).toContain('<span');
    expect(out).toMatch(/font-size\s*:\s*18px/);
    expect(out).toMatch(/line-height\s*:\s*1\.75/);
    expect(out).toMatch(/color\s*:\s*rgb\(9,\s*88,\s*217\)/);
  });

  it('剥离样式中的非白名单属性与外部资源', () => {
    const out = sanitizeRichHtml(
      '<p style="position: fixed; background-image: url(https://evil.test/x.png); text-align: right">a</p>',
    );
    expect(out).not.toContain('position');
    expect(out).not.toContain('background');
    expect(out).not.toContain('url(');
    expect(out).toMatch(/text-align\s*:\s*right/);
  });

  it('保留分割线', () => {
    expect(sanitizeRichHtml('<p>a</p><hr><p>b</p>')).toContain('<hr');
  });

  it('空输入返回空串', () => {
    expect(sanitizeRichHtml('')).toBe('');
  });

  it('保留正文文本', () => {
    expect(sanitizeRichHtml('<p>你好，世界</p>')).toBe('<p>你好，世界</p>');
  });
});
