import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';

// 媒体大类：视频或音频
export type MediaKind = 'video' | 'audio';
// 允许的媒体容器
export type MediaContainer = 'mp4' | 'webm' | 'm4a' | 'mp3';

// 每种媒体大类允许的容器
const CONTAINERS_BY_KIND: Record<MediaKind, readonly MediaContainer[]> = {
  video: ['mp4', 'webm'],
  audio: ['m4a', 'mp3'],
};

// 容器到标准 MIME 的映射
export const MIME_BY_CONTAINER: Record<MediaContainer, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
};

// WebM 的 EBML 文件头
const EBML_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

// WebM 的 DocType 元素：元素 ID 0x4282、长度 4、"webm"
const WEBM_DOCTYPE = Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);

// 允许识别为音频 M4A 的 ISO BMFF 主品牌
const M4A_BRANDS: readonly string[] = ['M4A ', 'M4B '];

// 允许识别为视频 MP4 的 ISO BMFF 主品牌
const MP4_BRANDS: readonly string[] = [
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'dash',
  'MSNV',
  'M4V ',
  'f4v ',
  'mmp4',
];

// ISO BMFF 文件头的最小长度（4 字节盒长度 + ftyp + 4 字节主品牌）
const ISO_BMFF_HEADER_LENGTH = 12;

// ISO BMFF 盒长的最小值（8 字节盒头 + 4 字节主品牌 + 4 字节次品牌）
const ISO_BMFF_MIN_BOX_SIZE = 16;

// 嗅探 DocType 时读取的最大字节数
const SNIFF_LENGTH = 64;

// ID3v2 标签头的最小长度
const ID3_HEADER_LENGTH = 10;

// ID3v2 允许的版本号下界
const ID3_MIN_VERSION = 2;

// ID3v2 允许的版本号上界
const ID3_MAX_VERSION = 4;

// MPEG 音频帧头的最小长度
const MPEG_FRAME_HEADER_LENGTH = 4;

// 识别 ISO BMFF（MP4/M4A）：按 ftyp 盒与主品牌白名单判定
function detectIsoBmff(buffer: Buffer): MediaContainer | null {
  // 长度不足或第 4-7 字节不是 ftyp 时无法判定
  if (
    buffer.length < ISO_BMFF_HEADER_LENGTH ||
    buffer.subarray(4, 8).toString('ascii') !== 'ftyp'
  ) {
    return null;
  }
  // 读取第 0-3 字节的盒长度，过短的盒不是合法媒体头
  const boxSize = buffer.readUInt32BE(0);
  if (boxSize < ISO_BMFF_MIN_BOX_SIZE) {
    return null;
  }
  // 主品牌位于第 8-11 字节
  const brand = buffer.subarray(8, 12).toString('ascii');
  // M4A/M4B 品牌按音频处理
  if (M4A_BRANDS.includes(brand)) {
    return 'm4a';
  }
  // 白名单内的品牌按视频 MP4 处理
  if (MP4_BRANDS.includes(brand)) {
    return 'mp4';
  }
  // 其余品牌（HEIF/AVIF/QuickTime/3GP 等）一律拒绝
  return null;
}

// 识别 WebM：EBML 头必须位于偏移 0，且前 64 字节内出现精确的 DocType=webm
function detectWebm(buffer: Buffer): MediaContainer | null {
  // EBML 头缺失时不是 Matroska 家族文件
  if (
    buffer.length < EBML_HEADER.length ||
    !buffer.subarray(0, EBML_HEADER.length).equals(EBML_HEADER)
  ) {
    return null;
  }
  // 按字节比对 DocType 元素序列，Matroska（matroska）不会命中
  if (!buffer.subarray(0, SNIFF_LENGTH).includes(WEBM_DOCTYPE)) {
    return null;
  }
  return 'webm';
}

// 识别 MP3：合法的 ID3v2 标签或合法的 MPEG 音频帧头
function detectMp3(buffer: Buffer): MediaContainer | null {
  // ID3v2 标签：至少 10 字节，前缀 ID3 且版本号为 2~4
  if (
    buffer.length >= ID3_HEADER_LENGTH &&
    buffer.subarray(0, 3).toString('ascii') === 'ID3'
  ) {
    // 版本号位于第 3 字节
    const id3Version = buffer[3];
    // 版本号不在允许范围时视为伪装标签
    return id3Version >= ID3_MIN_VERSION && id3Version <= ID3_MAX_VERSION
      ? 'mp3'
      : null;
  }
  // MPEG 音频帧头至少需要 4 字节用于校验各字段
  if (buffer.length < MPEG_FRAME_HEADER_LENGTH) {
    return null;
  }
  // 首字节必须为 0xFF，次字节高 3 位必须全为 1（帧同步字）
  if (buffer[0] !== 0xff || (buffer[1] & 0xe0) !== 0xe0) {
    return null;
  }
  // 版本位：01 为保留值
  const versionBits = (buffer[1] >> 3) & 0x03;
  // 层位：00 为保留值
  const layerBits = (buffer[1] >> 1) & 0x03;
  // 比特率索引：0000 为 free、1111 为非法值
  const bitrateIndex = (buffer[2] >> 4) & 0x0f;
  // 采样率索引：11 为保留值
  const sampleRateIndex = (buffer[2] >> 2) & 0x03;
  // 命中任一保留/非法字段说明不是 MPEG 音频帧
  if (
    versionBits === 1 ||
    layerBits === 0 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleRateIndex === 3
  ) {
    return null;
  }
  return 'mp3';
}

// 根据文件头识别媒体容器；无法识别返回 null
export function detectMediaContainer(buffer: Buffer): MediaContainer | null {
  // 依次尝试 ISO BMFF、WebM、MP3 三种容器
  const container =
    detectIsoBmff(buffer) ?? detectWebm(buffer) ?? detectMp3(buffer);
  // 全部未命中时视为未知类型
  return container;
}

// 断言容器与上传接口类型匹配，返回容器与 MIME
export function assertMediaContainer(
  buffer: Buffer,
  kind: MediaKind,
): { container: MediaContainer; mimeType: string } {
  // 先识别真实容器
  const container = detectMediaContainer(buffer);
  if (!container) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '仅支持 MP4/WebM 视频与 MP3/M4A 音频',
      422,
    );
  }
  // 容器必须属于该接口允许的集合
  if (!CONTAINERS_BY_KIND[kind].includes(container)) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '文件类型与上传接口不匹配',
      422,
    );
  }
  return { container, mimeType: MIME_BY_CONTAINER[container] };
}
