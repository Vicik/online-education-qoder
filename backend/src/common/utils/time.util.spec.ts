import { toShanghaiISO } from './time.util';

describe('toShanghaiISO', () => {
  it('将 UTC 转东八区展示串', () => {
    expect(toShanghaiISO(new Date('2026-01-01T02:00:00Z'))).toBe(
      '2026-01-01 10:00:00',
    );
  });

  it('跨日进位', () => {
    expect(toShanghaiISO(new Date('2026-01-01T16:00:00Z'))).toBe(
      '2026-01-02 00:00:00',
    );
  });

  it('午夜输出 00 而非 24', () => {
    expect(toShanghaiISO(new Date('2026-06-15T16:00:00Z'))).toBe(
      '2026-06-16 00:00:00',
    );
  });

  it('秒级精度补零', () => {
    expect(toShanghaiISO(new Date('2026-03-05T01:02:03Z'))).toBe(
      '2026-03-05 09:02:03',
    );
  });

  it('不受运行环境本地时区影响', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(toShanghaiISO(new Date('2026-01-01T02:00:00Z'))).toBe(
        '2026-01-01 10:00:00',
      );
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
