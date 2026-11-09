import { BizException } from '../common/exceptions/biz.exception';
import { ErrorCode } from '../common/constants/error-codes';

// 允许上传的图片类型
export type ImageType = 'png' | 'jpeg' | 'webp';

// PNG 文件签名（8 字节）
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 根据文件头（magic bytes）识别图片真实类型。
 * 不信任扩展名或 Content-Type，无法识别时按 openapi 的 422 语义拒绝。
 */
export function detectImageType(buf: Buffer): ImageType {
  // PNG：前 8 字节必须完全匹配签名
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  // JPEG：以 FF D8 FF 开头（SOI + 段起始标记）
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  // WebP：RIFF 容器，第 8-11 字节为 WEBP
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  // 其余内容（伪造扩展名的文本、EXE 等）一律拒绝
  throw new BizException(ErrorCode.PARAM_INVALID, '图片格式仅支持 PNG/JPEG/WebP', 422);
}
