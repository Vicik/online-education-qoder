import { renderHook } from '@testing-library/react';
import { useClickGuard } from '@/hooks/useClickGuard';

describe('useClickGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('冷却期内的重复触发只执行一次', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useClickGuard(handler, 800));
    result.current('a');
    result.current('a');
    result.current('a');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith('a');

    vi.advanceTimersByTime(799);
    result.current('b');
    expect(handler).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    result.current('c');
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith('c');
  });

  it('始终调用最新的 handler', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ handler }) => useClickGuard(handler, 0), {
      initialProps: { handler: first },
    });
    rerender({ handler: second });
    result.current();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
