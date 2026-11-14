import { deriveActivityStatus } from './activity-status';

describe('deriveActivityStatus', () => {
  // 固定当前时间：2027-01-05 00:00:00Z
  const NOW = new Date('2027-01-05T00:00:00Z');

  it('未到开始时间展示为未开始', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'not_started',
          startAt: new Date('2027-01-06T00:00:00Z'),
          endAt: new Date('2027-01-07T00:00:00Z'),
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
          startAt: new Date('2027-01-04T00:00:00Z'),
          endAt: new Date('2027-01-06T00:00:00Z'),
        },
        NOW,
      ),
    ).toBe('ongoing');
  });

  it('已过结束时间展示为已结束（即使物化状态滞后）', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'ongoing',
          startAt: new Date('2027-01-01T00:00:00Z'),
          endAt: new Date('2027-01-02T00:00:00Z'),
        },
        NOW,
      ),
    ).toBe('ended');
  });

  it('未到开始但已过结束（错过整段）直接展示为已结束', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'not_started',
          startAt: new Date('2027-01-01T00:00:00Z'),
          endAt: new Date('2027-01-02T00:00:00Z'),
        },
        NOW,
      ),
    ).toBe('ended');
  });

  it('已取消保持取消，不随起止时间变化', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'cancelled',
          startAt: new Date('2027-01-04T00:00:00Z'),
          endAt: new Date('2027-01-06T00:00:00Z'),
        },
        NOW,
      ),
    ).toBe('cancelled');
  });

  it('已结束为终态，不因时钟回拨重新展示为进行中', () => {
    expect(
      deriveActivityStatus(
        {
          status: 'ended',
          startAt: new Date('2027-01-04T00:00:00Z'),
          endAt: new Date('2027-01-06T00:00:00Z'),
        },
        NOW,
      ),
    ).toBe('ended');
  });
});
