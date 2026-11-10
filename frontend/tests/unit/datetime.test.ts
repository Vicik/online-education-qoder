import { formatCountdown, formatShanghai, isPast } from '@/lib/datetime';

describe('datetime', () => {
  it('UTC 转 Asia/Shanghai 展示', () => {
    expect(formatShanghai('2026-01-01T02:00:00Z')).toBe('2026-01-01 10:00');
  });
  it('倒计时格式化', () => {
    expect(formatCountdown(10_000)).toBe('00:00:10');
    expect(formatCountdown(3_661_000)).toBe('01:01:01');
    expect(formatCountdown(-1)).toBe('00:00:00');
  });
  it('服务端时间判断到期', () => {
    expect(isPast('2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:00:01Z'))).toBe(true);
  });
});
