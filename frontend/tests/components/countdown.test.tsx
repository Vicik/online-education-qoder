import { act, render, screen } from '@testing-library/react';
import { Countdown } from '@/components/common/Countdown';

describe('Countdown', () => {
  it('使用服务端时间并在到期时只回调一次', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const onExpire = vi.fn();
    render(<Countdown deadlineAt="2026-01-01T00:00:10Z" onExpire={onExpire} />);
    expect(screen.getByText('00:00:10')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
