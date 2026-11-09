import { applyImageUrls, collectImageKeys, isStorageKey } from './media.util';

describe('isStorageKey', () => {
  it.each([
    'zhixu/2026/11/2f3c.png',
    'videos/ch1.mp4',
    'a.png',
    'bucket/folder/name.webp',
  ])('%s 视为对象存储 key', (value) => {
    expect(isStorageKey(value)).toBe(true);
  });

  it.each([
    '',
    '   ',
    null,
    undefined,
    123,
    'https://cdn.test/a.png',
    'http://cdn.test/a.png',
    '//cdn.test/a.png',
    '/uploads/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,xx',
    ' a.png',
    'a b.png',
    'zhixu/../secret.png',
    'zhixu//a.png',
  ])('%s 不视为对象存储 key', (value) => {
    expect(isStorageKey(value)).toBe(false);
  });
});

describe('collectImageKeys', () => {
  it('无图片返回空数组', () => {
    expect(collectImageKeys('<p>你好</p>')).toEqual([]);
    expect(collectImageKeys('')).toEqual([]);
  });

  it('优先取 data-key，非法或缺失时回退到 key 形式的 src', () => {
    const html =
      '<img data-key="zhixu/a.png" src="zhixu/a.png" />' +
      '<img src="zhixu/b.png" />' +
      '<img src="https://cdn.test/c.png" />' +
      '<img data-key="javascript:alert(1)" src="zhixu/d.png" />';
    expect(collectImageKeys(html)).toEqual([
      'zhixu/a.png',
      'zhixu/b.png',
      'zhixu/d.png',
    ]);
  });

  it('同一 key 只收集一次', () => {
    const html =
      '<img data-key="zhixu/a.png" />' +
      '<img src="zhixu/a.png" />' +
      '<img data-key="zhixu/a.png" />';
    expect(collectImageKeys(html)).toEqual(['zhixu/a.png']);
  });
});

describe('applyImageUrls', () => {
  it('空输入返回空串', () => {
    expect(applyImageUrls('', new Map())).toBe('');
  });

  it('按 data-key 重写 src 并保留 data-key', () => {
    const html =
      '<p>正文</p><img data-key="zhixu/a.png" src="zhixu/a.png" alt="图" />';
    const out = applyImageUrls(
      html,
      new Map([['zhixu/a.png', 'https://signed/a.png']]),
    );

    expect(out).toContain('src="https://signed/a.png"');
    expect(out).toContain('data-key="zhixu/a.png"');
    expect(out).toContain('alt="图"');
    expect(out).toContain('<p>正文</p>');
  });

  it('仅 src 为 key 时也重写，且不补 data-key', () => {
    const out = applyImageUrls(
      '<img src="zhixu/b.png" />',
      new Map([['zhixu/b.png', 'https://signed/b.png']]),
    );

    expect(out).toContain('src="https://signed/b.png"');
    expect(out).not.toContain('data-key');
  });

  it('历史 http(s) 图片原样返回', () => {
    const html = '<img src="https://cdn.test/legacy.png" alt="旧图" />';
    expect(applyImageUrls(html, new Map())).toBe(html);
  });

  it('未收集到签名的 key 保持原状', () => {
    const html = '<img data-key="zhixu/c.png" src="zhixu/c.png" />';
    expect(applyImageUrls(html, new Map())).toBe(html);
  });
});
