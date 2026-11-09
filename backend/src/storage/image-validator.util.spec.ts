import { detectImageType } from './image-validator.util';

// PNG 文件头：8 字节签名
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// JPEG 文件头：SOI + APP0 起始
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
// WebP 文件头：RIFF + 4 字节长度 + WEBP
const WEBP = Buffer.from('RIFFxxxxWEBP', 'ascii');

describe('detectImageType（magic bytes）', () => {
  it('PNG/JPEG/WebP 签名识别正确', () => {
    expect(detectImageType(PNG)).toBe('png');
    expect(detectImageType(JPEG)).toBe('jpeg');
    expect(detectImageType(WEBP)).toBe('webp');
  });

  it('伪造扩展名被拒：text 内容带 .png 名', () => {
    const fake = Buffer.from('GIF89a not a png at all', 'ascii');
    expect(() => detectImageType(fake)).toThrow(/图片格式/);
  });

  it('EXE 伪装 jpg 被拒', () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
    expect(() => detectImageType(exe)).toThrow();
  });
});
