import {
  isAllowedMedia,
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

// 构造指定大小的伪文件：jsdom 不允许真的分配 1GB
function fakeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('isAllowedMedia', () => {
  it('视频按 MIME 或扩展名识别，并限制 1GB', () => {
    expect(isAllowedMedia(fakeFile('a.mp4', 'video/mp4', 1024), 'video')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.webm', 'video/webm', 1024), 'video')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.mp4', '', 1024), 'video')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.mkv', 'video/x-matroska', 1024), 'video')).toBe(false);
    expect(isAllowedMedia(fakeFile('a.mp4', 'video/mp4', 1024 * 1024 * 1024), 'video')).toBe(
      true,
    );
    expect(
      isAllowedMedia(fakeFile('a.mp4', 'video/mp4', 1024 * 1024 * 1024 + 1), 'video'),
    ).toBe(false);
  });

  it('音频接受 MP3/M4A，并限制 100MB', () => {
    expect(isAllowedMedia(fakeFile('a.mp3', 'audio/mpeg', 1024), 'audio')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.m4a', 'audio/mp4', 1024), 'audio')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.m4a', '', 1024), 'audio')).toBe(true);
    expect(isAllowedMedia(fakeFile('a.wav', 'audio/wav', 1024), 'audio')).toBe(false);
    expect(
      isAllowedMedia(fakeFile('a.mp3', 'audio/mpeg', 100 * 1024 * 1024 + 1), 'audio'),
    ).toBe(false);
  });

  it('空文件不允许', () => {
    expect(isAllowedMedia(fakeFile('a.mp4', 'video/mp4', 0), 'video')).toBe(false);
  });
});
