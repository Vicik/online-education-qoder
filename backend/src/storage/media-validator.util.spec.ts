import {
  assertMediaContainer,
  detectMediaContainer,
} from './media-validator.util';

// 构造 ISO BMFF 文件头：4 字节长度 + ftyp + 品牌
function ftyp(brand: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp'),
    Buffer.from(brand),
    Buffer.alloc(8, 0x01),
  ]);
}

// WebM 头 + doctype
const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from([0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84]),
  Buffer.from('webm'),
]);

describe('detectMediaContainer', () => {
  it('识别 MP4、M4A、WebM、MP3', () => {
    expect(detectMediaContainer(ftyp('isom'))).toBe('mp4');
    expect(detectMediaContainer(ftyp('M4A '))).toBe('m4a');
    expect(detectMediaContainer(ftyp('M4B '))).toBe('m4a');
    expect(detectMediaContainer(WEBM)).toBe('webm');
    expect(detectMediaContainer(Buffer.from('ID3\u0004\u0000\u0000'))).toBe(
      'mp3',
    );
    expect(detectMediaContainer(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe(
      'mp3',
    );
  });

  it('无法识别的文本返回 null', () => {
    expect(detectMediaContainer(Buffer.from('not a media file'))).toBeNull();
    expect(detectMediaContainer(Buffer.alloc(0))).toBeNull();
  });
});

describe('assertMediaContainer', () => {
  it('视频接口只接受 MP4/WebM', () => {
    expect(assertMediaContainer(ftyp('isom'), 'video')).toEqual({
      container: 'mp4',
      mimeType: 'video/mp4',
    });
    expect(assertMediaContainer(WEBM, 'video')).toEqual({
      container: 'webm',
      mimeType: 'video/webm',
    });
    expect(() => assertMediaContainer(ftyp('M4A '), 'video')).toThrow();
  });

  it('音频接口只接受 M4A/MP3，并返回对应 MIME', () => {
    expect(assertMediaContainer(ftyp('M4A '), 'audio')).toEqual({
      container: 'm4a',
      mimeType: 'audio/mp4',
    });
    expect(
      assertMediaContainer(Buffer.from('ID3\u0004\u0000\u0000'), 'audio'),
    ).toEqual({
      container: 'mp3',
      mimeType: 'audio/mpeg',
    });
    expect(() => assertMediaContainer(ftyp('isom'), 'audio')).toThrow();
  });

  it('类型不匹配映射为 422/code=1001', () => {
    expect(() => assertMediaContainer(Buffer.from('text'), 'video')).toThrow(
      expect.objectContaining({ bizCode: 1001, status: 422 }),
    );
    expect(() => assertMediaContainer(ftyp('isom'), 'audio')).toThrow(
      expect.objectContaining({ bizCode: 1001, status: 422 }),
    );
  });
});
