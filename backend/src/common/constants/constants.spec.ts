import { EMAIL_REGEX, PASSWORD_REGEX } from './constants';

describe('PASSWORD_REGEX', () => {
  it.each(['abc12345', 'a1234567', 'A1aaaaaa', `a1${'b'.repeat(62)}`])(
    '接受 %s',
    (value) => {
      expect(PASSWORD_REGEX.test(value)).toBe(true);
    },
  );

  it.each([
    ['abcdefgh', '缺数字'],
    ['12345678', '缺字母'],
    ['ab12345', '不足 8 位'],
    [`a1${'b'.repeat(63)}`, '超过 64 位'],
    ['密码密码密码12', '中文不算字母'],
    ['abc 12345', '含空格'],
    ['', '空串'],
  ])('拒绝 %s（%s）', (value) => {
    expect(PASSWORD_REGEX.test(value)).toBe(false);
  });
});

describe('EMAIL_REGEX', () => {
  it.each(['user@example.com', 'a.b+tag@sub.example.co.uk'])(
    '接受 %s',
    (value) => {
      expect(EMAIL_REGEX.test(value)).toBe(true);
    },
  );

  it.each([
    'user@localhost',
    'a b@x.com',
    '@example.com',
    'user@@x.com',
    'user@x',
    '',
  ])('拒绝 %s', (value) => {
    expect(EMAIL_REGEX.test(value)).toBe(false);
  });
});
