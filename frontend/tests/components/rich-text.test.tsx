import { render, screen } from '@testing-library/react';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import {
  sanitizeRichHtml,
  serializeRichHtmlForSave,
  truncateRichTables,
} from '@/lib/sanitize';

describe('rich text', () => {
  it('净化后保留对齐、颜色、字号、行距与分割线', () => {
    const output = sanitizeRichHtml(
      '<h2 style="text-align: center">标题</h2>' +
        '<p style="line-height: 1.75"><span style="font-size: 18px; color: #0958d9">正文</span></p>' +
        '<hr>',
    );
    expect(output).toMatch(/text-align\s*:\s*center/);
    expect(output).toMatch(/line-height\s*:\s*1\.75/);
    expect(output).toMatch(/font-size\s*:\s*18px/);
    // jsdom 会把十六进制颜色归一化为 rgb
    expect(output).toMatch(/color\s*:\s*(#0958d9|rgb\(9,\s*88,\s*217\))/i);
    expect(output).toContain('<span');
    expect(output).toContain('<hr');
  });

  it('净化后剥离危险样式属性', () => {
    const output = sanitizeRichHtml(
      '<p style="position: fixed; background-image: url(https://evil.test/x.png); text-align: right">a</p>',
    );
    expect(output).not.toContain('position');
    expect(output).not.toContain('background');
    expect(output).not.toContain('url(');
    expect(output).toMatch(/text-align\s*:\s*right/);
  });

  it('展示端再次净化', () => {
    render(<RichTextViewer html={'<p onclick="x()">正文</p><script>alert(1)</script>'} />);
    expect(screen.getByText('正文')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
  it('保存前图片 src 回写为 data-key', () => {
    const html = '<img src="https://signed/a" data-key="covers/a.png" alt="a">';
    const output = serializeRichHtmlForSave(html);
    expect(output).toContain('src="covers/a.png"');
    expect(output).toContain('data-key="covers/a.png"');
  });
  it('表格超过 20×20 截断', () => {
    const cell = '<td>x</td>';
    const row = `<tr>${cell.repeat(25)}</tr>`;
    const output = truncateRichTables(`<table>${row.repeat(25)}</table>`);
    const parsed = new DOMParser().parseFromString(output, 'text/html');
    expect(parsed.querySelectorAll('tr')).toHaveLength(20);
    expect(parsed.querySelectorAll('tr')[0].children).toHaveLength(20);
  });
});
