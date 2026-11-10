import { isStorageKey, resolveImageUrl } from '@/lib/image-url';

describe('image-url', () => {
  it('识别对象存储 key 与历史 URL', () => {
    expect(isStorageKey('covers/abc.png')).toBe(true);
    expect(isStorageKey('https://cdn.example.com/a.png')).toBe(false);
    expect(isStorageKey(null)).toBe(false);
  });
  it('优先使用签名 URL', () => {
    expect(resolveImageUrl('covers/abc.png', 'https://signed')).toBe('https://signed');
    expect(resolveImageUrl('https://old.example.com/a.png')).toBe('https://old.example.com/a.png');
    expect(resolveImageUrl('covers/abc.png')).toBeUndefined();
  });
});
