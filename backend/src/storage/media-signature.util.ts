import { createHmac, timingSafeEqual } from 'node:crypto';

// 签名格式：SHA-256 的 base64url 固定 43 位
export const MEDIA_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// 生成媒体签名：对 `${key}:${exp}` 做 HMAC-SHA256，输出 base64url
export function signMediaKey(secret: string, key: string, exp: number): string {
  return createHmac('sha256', secret)
    .update(`${key}:${exp}`)
    .digest('base64url');
}

// 校验媒体签名：检查时间戳、格式，并用常量时间比较
export function isValidMediaSignature(
  secret: string,
  key: string,
  exp: number,
  sig: string,
): boolean {
  // exp 必须是整数秒
  if (!Number.isInteger(exp)) return false;
  // 已过期直接拒绝
  if (exp < Math.floor(Date.now() / 1000)) return false;
  // 签名长度与字符集必须匹配
  if (!MEDIA_SIGNATURE_PATTERN.test(sig)) return false;

  // 重新计算期望签名
  const expected = signMediaKey(secret, key, exp);
  // 客户端签名转字节
  const actualBuffer = Buffer.from(sig, 'ascii');
  // 期望签名转字节
  const expectedBuffer = Buffer.from(expected, 'ascii');
  // 长度不一致时提前返回，避免 timingSafeEqual 抛错
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
