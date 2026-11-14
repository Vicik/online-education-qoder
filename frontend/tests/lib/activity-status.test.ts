import { deriveActivityStatus } from '@/lib/activity-status';

describe('deriveActivityStatus', () => {
  // 固定当前时间：2027-01-05 00:00:00Z
  const NOW = Date.parse('2027-01-05T00:00:00Z');

  it('未到开始时间展示为未开始', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'not_started',
          startAt: '2027-01-06T00:00:00Z',
          endAt: '2027-01-07T00:00:00Z',
        },
        NOW,
      ),
    ).toBe('not_started');
  });

  it('处于时间区间展示为进行中', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'ongoing',
          startAt: '2027-01-04T00:00:00Z',
          endAt: '2027-01-06T00:00:00Z',
        },
        NOW,
      ),
    ).toBe('ongoing');
  });

  it('已过结束时间展示为已结束（即使状态仍为进行中）', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'ongoing',
          startAt: '2027-01-01T00:00:00Z',
          endAt: '2027-01-02T00:00:00Z',
        },
        NOW,
      ),
    ).toBe('ended');
  });

  it('未开始但已过结束（错过整段）展示为已结束', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'not_started',
          startAt: '2027-01-01T00:00:00Z',
          endAt: '2027-01-02T00:00:00Z',
        },
        NOW,
      ),
    ).toBe('ended');
  });

  it('已取消保持取消', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'cancelled',
          startAt: '2027-01-04T00:00:00Z',
          endAt: '2027-01-06T00:00:00Z',
        },
        NOW,
      ),
    ).toBe('cancelled');
  });

  it('已结束为终态，不因时间回退重新展示为进行中', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'ended',
          startAt: '2027-01-04T00:00:00Z',
          endAt: '2027-01-06T00:00:00Z',
        },
        NOW,
      ),
    ).toBe('ended');
  });

  it('起止时间缺失时回退已存状态', () => {
    expect(deriveActivityStatus({ status: 'ongoing' }, NOW)).toBe('ongoing');
    expect(deriveActivityStatus({ status: 'not_started' }, NOW)).toBe('not_started');
  });

  it('时间非法时回退已存状态', () => {
    expect(
      deriveActivityStatus(
        { status: 'ongoing', startAt: 'not-a-date', endAt: 'not-a-date' },
        NOW,
      ),
    ).toBe('ongoing');
  });
});
