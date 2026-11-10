import { render, screen } from '@testing-library/react';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { serializeRichHtmlForSave, truncateRichTables } from '@/lib/sanitize';

describe('rich text', () => {
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
