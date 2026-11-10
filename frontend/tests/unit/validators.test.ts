import {
  validateConfirmPassword,
  validateEmail,
  validatePassScore,
  validatePassword,
  validateTimeRange,
} from '@/lib/validators';

describe('validators', () => {
  it('邮箱格式', () => {
    expect(validateEmail('user@example.com')).toBeNull();
    expect(validateEmail('bad')).toBe('请输入正确的邮箱');
  });
  it('密码 8–64 位，至少一个字母和一个数字，不允许中文与空格', () => {
    expect(validatePassword('abc12345')).toBeNull();
    expect(validatePassword('abcdefgh')).not.toBeNull();
    expect(validatePassword('12345678')).not.toBeNull();
    expect(validatePassword('abc 12345')).not.toBeNull();
    expect(validatePassword('密码abc12345')).not.toBeNull();
  });
  it('确认密码一致', () => {
    expect(validateConfirmPassword('abc12345', 'abc12345')).toBeNull();
    expect(validateConfirmPassword('abc12345', 'abc12346')).toBe('两次输入的密码不一致');
  });
  it('及格分大于 0 且不超过总分', () => {
    expect(validatePassScore(60, 100)).toBeNull();
    expect(validatePassScore(0, 100)).not.toBeNull();
    expect(validatePassScore(101, 100)).not.toBeNull();
  });
  it('结束时间必须晚于开始时间', () => {
    expect(validateTimeRange('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toBeNull();
    expect(validateTimeRange('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')).not.toBeNull();
  });
});
