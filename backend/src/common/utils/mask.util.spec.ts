import { maskEmail } from './mask.util';

describe('maskEmail', () => {
  it('保留首字符与域名', () => {
    expect(maskEmail('user@example.com')).toBe('u***@example.com');
  });

  it('长本地段也只保留首字符', () => {
    expect(maskEmail('zhangsan.li@example.com')).toBe('z***@example.com');
  });

  it('本地段长度小于 3 时整体打码', () => {
    expect(maskEmail('ab@example.com')).toBe('***@example.com');
    expect(maskEmail('a@example.com')).toBe('***@example.com');
  });

  it('非法邮箱整体打码，不泄露原文', () => {
    expect(maskEmail('not-an-email')).toBe('***');
    expect(maskEmail('')).toBe('***');
    expect(maskEmail('@example.com')).toBe('***');
  });
});
