import {
  isValidMediaSignature,
  MEDIA_SIGNATURE_PATTERN,
  signMediaKey,
} from './media-signature.util';

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

  it('非整数 exp 即使携带自身签名也被拒绝', () => {
    // 未来时间戳附加 0.5，过期分支不会拦截，只能由整数校验拒绝
    const exp = Math.floor(Date.now() / 1000) + 60 + 0.5;
    const sig = signMediaKey(SECRET, KEY, exp);
    expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidMediaSignature(SECRET, KEY, exp, sig)).toBe(false);
  });

  it('43 位但含非 base64url 字符的签名被拒绝', () => {
    const exp = futureExp();
    const sig = signMediaKey(SECRET, KEY, exp);
    const invalid = '!'.repeat(43);
    // 长度与合法签名一致，只能由字符集校验拒绝
    expect(invalid).toHaveLength(43);
    expect(MEDIA_SIGNATURE_PATTERN.test(sig)).toBe(true);
    expect(MEDIA_SIGNATURE_PATTERN.test(invalid)).toBe(false);
    expect(isValidMediaSignature(SECRET, KEY, exp, invalid)).toBe(false);
  });

  it('exp 参与 HMAC 运算，换用另一未来时间戳即验证失败', () => {
    const expA = futureExp();
    const expB = expA + 1;
    const sig = signMediaKey(SECRET, KEY, expA);
    // 两个时间戳都是未来，过期分支无法掩盖绑定关系
    expect(isValidMediaSignature(SECRET, KEY, expA, sig)).toBe(true);
    expect(isValidMediaSignature(SECRET, KEY, expB, sig)).toBe(false);
  });

  it('exp 等于当前秒时仍有效，时钟前进 1 秒后立即失效', () => {
    // 冻结 Date.now，避免依赖真实时钟
    const fixedNow = 1700000000000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);
    try {
      const exp = Math.floor(fixedNow / 1000);
      const sig = signMediaKey(SECRET, KEY, exp);
      expect(isValidMediaSignature(SECRET, KEY, exp, sig)).toBe(true);
      // 时钟前进 1000ms，同一签名越过边界即失效
      nowSpy.mockReturnValue(fixedNow + 1000);
      expect(isValidMediaSignature(SECRET, KEY, exp, sig)).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
