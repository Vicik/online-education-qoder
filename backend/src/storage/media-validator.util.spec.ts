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

// WebM 头 + doctype webm
const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from([0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84]),
  Buffer.from('webm'),
]);

// Matroska（MKV）头：EBML 头 + 长度 0x88 的 doctype matroska
const MKV = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from([0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88]),
  Buffer.from('matroska'),
]);

// 只有 webm DocType、但偏移 0 不是 EBML 头的伪 WebM
const WEBM_WITHOUT_EBML = Buffer.concat([
  Buffer.from('zzzz'),
  Buffer.from([0x42, 0x82, 0x84]),
  Buffer.from('webm'),
  Buffer.alloc(16, 0x02),
]);

// 合法的最小 ID3v2.4 标签头（10 字节）
const ID3 = Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000');

describe('detectMediaContainer', () => {
  it('识别 MP4、M4A、WebM、MP3', () => {
    expect(detectMediaContainer(ftyp('isom'))).toBe('mp4');
    expect(detectMediaContainer(ftyp('M4A '))).toBe('m4a');
    expect(detectMediaContainer(ftyp('M4B '))).toBe('m4a');
    expect(detectMediaContainer(WEBM)).toBe('webm');
    expect(detectMediaContainer(ID3)).toBe('mp3');
    expect(detectMediaContainer(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe(
      'mp3',
    );
  });

  it('拒绝其他 ISO BMFF 品牌（HEIF/AVIF/QuickTime/3GP）', () => {
    expect(detectMediaContainer(ftyp('heic'))).toBeNull();
    expect(detectMediaContainer(ftyp('avif'))).toBeNull();
    expect(detectMediaContainer(ftyp('qt  '))).toBeNull();
    expect(detectMediaContainer(ftyp('3gp4'))).toBeNull();
  });

  it('拒绝盒长过小的 ISO BMFF 文件头', () => {
    const smallBox = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x08]),
      Buffer.from('ftyp'),
      Buffer.from('isom'),
    ]);
    expect(smallBox.length).toBe(12);
    expect(detectMediaContainer(smallBox)).toBeNull();
  });

  it('拒绝 Matroska（MKV）与缺少 EBML 头的伪 WebM', () => {
    expect(detectMediaContainer(MKV)).toBeNull();
    expect(detectMediaContainer(WEBM_WITHOUT_EBML)).toBeNull();
    expect(
      detectMediaContainer(Buffer.from('this text mentions webm twice: webm')),
    ).toBeNull();
  });

  it('拒绝过短的 ID3 头与保留字段的伪 MPEG 帧', () => {
    expect(
      detectMediaContainer(Buffer.from('ID3\u0004\u0000\u0000')),
    ).toBeNull();
    expect(
      detectMediaContainer(Buffer.from([0xff, 0xe0, 0x00, 0x00])),
    ).toBeNull();
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
    expect(() => assertMediaContainer(ftyp('M4A '), 'video')).toThrow(
      expect.objectContaining({ bizCode: 1001, status: 422 }),
    );
  });

  it('音频接口只接受 M4A/MP3，并返回对应 MIME', () => {
    expect(assertMediaContainer(ftyp('M4A '), 'audio')).toEqual({
      container: 'm4a',
      mimeType: 'audio/mp4',
    });
    expect(assertMediaContainer(ID3, 'audio')).toEqual({
      container: 'mp3',
      mimeType: 'audio/mpeg',
    });
    expect(() => assertMediaContainer(ftyp('isom'), 'audio')).toThrow(
      expect.objectContaining({ bizCode: 1001, status: 422 }),
    );
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
