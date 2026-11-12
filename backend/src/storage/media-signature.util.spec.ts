import { isValidMediaSignature, signMediaKey } from './media-signature.util';

// 测试密钥
const SECRET = 'test-secret';
// 固定的媒体 key
const KEY = 'video/2026/11/12/00000000-0000-0000-0000-000000000001.mp4';

// 生成未来时间戳
function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 60;
}

describe('media signature', () => {
  it('生成的签名固定 43 位 base64url 且可验证', () => {
    const exp = futureExp();
    const sig = signMediaKey(SECRET, KEY, exp);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidMediaSignature(SECRET, KEY, exp, sig)).toBe(true);
  });

  it('篡改 key 或签名后验证失败', () => {
    const exp = futureExp();
    const sig = signMediaKey(SECRET, KEY, exp);
    expect(isValidMediaSignature(SECRET, `${KEY}x`, exp, sig)).toBe(false);
    const tampered = `${sig.slice(0, 42)}${sig[42] === 'A' ? 'B' : 'A'}`;
    expect(isValidMediaSignature(SECRET, KEY, exp, tampered)).toBe(false);
  });

  it('过期或未来时间戳格式错误时验证失败', () => {
    const expired = Math.floor(Date.now() / 1000) - 10;
    const expiredSig = signMediaKey(SECRET, KEY, expired);
    expect(isValidMediaSignature(SECRET, KEY, expired, expiredSig)).toBe(false);

    const exp = futureExp();
    expect(isValidMediaSignature(SECRET, KEY, exp, 'short')).toBe(false);
    expect(
      isValidMediaSignature(
        SECRET,
        KEY,
        Number.NaN,
        signMediaKey(SECRET, KEY, exp),
      ),
    ).toBe(false);
  });
});
