import { act, render } from '@testing-library/react';
import { RequestOverlay } from '@/components/common/RequestOverlay';
import { useRequestActivityStore } from '@/stores/request-activity';

describe('RequestOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useRequestActivityStore.setState({ pendingCount: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('延迟 120ms 显示，请求归零后隐藏', () => {
    const { container } = render(<RequestOverlay />);
    const overlay = container.querySelector('.request-overlay') as HTMLElement;
    expect(overlay).not.toHaveClass('is-visible');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');

    act(() => useRequestActivityStore.getState().startRequest());
    act(() => vi.advanceTimersByTime(119));
    expect(overlay).not.toHaveClass('is-visible');

    act(() => vi.advanceTimersByTime(1));
    expect(overlay).toHaveClass('is-visible');
    expect(overlay).toHaveAttribute('aria-hidden', 'false');

    act(() => useRequestActivityStore.getState().finishRequest());
    expect(overlay).not.toHaveClass('is-visible');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
  });

  it('并发请求全部结束前保持显示', () => {
    const { container } = render(<RequestOverlay />);
    const overlay = container.querySelector('.request-overlay') as HTMLElement;
    act(() => {
      useRequestActivityStore.getState().startRequest();
      useRequestActivityStore.getState().startRequest();
    });
    act(() => vi.advanceTimersByTime(120));
    expect(overlay).toHaveClass('is-visible');

    act(() => useRequestActivityStore.getState().finishRequest());
    expect(overlay).toHaveClass('is-visible');

    act(() => useRequestActivityStore.getState().finishRequest());
    expect(overlay).not.toHaveClass('is-visible');
  });
});
