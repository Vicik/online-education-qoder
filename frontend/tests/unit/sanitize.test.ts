import { sanitizeRichHtml, serializeRichHtmlForSave } from '@/lib/sanitize';

describe('sanitize', () => {
  it('剥离 script 与事件属性', () => {
    const output = sanitizeRichHtml('<p onclick="x()">a</p><script>alert(1)</script>');
    expect(output).not.toContain('<script');
    expect(output).not.toContain('onclick');
  });
  it('保留图片 data-key 与表格', () => {
    const output = sanitizeRichHtml(
      '<img src="https://signed" data-key="covers/a.png" alt="a"><table><tr><td>x</td></tr></table>',
    );
    expect(output).toContain('data-key="covers/a.png"');
    expect(output).toContain('<table>');
  });
  it('保存前把 img src 回写为 data-key', () => {
    const output = serializeRichHtmlForSave(
      '<p><img src="https://signed/abc" data-key="covers/a.png" alt="a"></p>',
    );
    expect(output).toContain('src="covers/a.png"');
    expect(output).toContain('data-key="covers/a.png"');
  });
});
