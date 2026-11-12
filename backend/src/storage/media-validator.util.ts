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

// 根据文件头识别媒体容器；无法识别返回 null
export function detectMediaContainer(buffer: Buffer): MediaContainer | null {
  // ISO BMFF（MP4/M4A）：第 4-7 字节固定为 ftyp
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  ) {
    // 主品牌位于第 8-11 字节
    const brand = buffer.subarray(8, 12).toString('ascii');
    // M4A/M4B 品牌按音频处理，其余品牌按视频 MP4 处理
    return brand === 'M4A ' || brand === 'M4B ' ? 'm4a' : 'mp4';
  }

  // WebM：EBML 头 + 前 64 字节内出现 doctype webm
  if (
    buffer.length >= 4 &&
    buffer.subarray(0, 4).equals(EBML_HEADER) &&
    buffer
      .subarray(0, Math.min(buffer.length, 64))
      .toString('ascii')
      .includes('webm')
  ) {
    return 'webm';
  }

  // MP3：ID3v2 标签或 MPEG 音频帧同步字
  if (
    (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') ||
    (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  ) {
    return 'mp3';
  }

  // 其余内容一律视为未知
  return null;
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
