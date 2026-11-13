import { fireEvent, render, screen } from '@testing-library/react';
import { useAutoScroll } from '@/hooks/useAutoScroll';

// 测试组件：把 hook 的引用与事件挂到可滚动容器上
function Demo({ enabled = true }: { enabled?: boolean }) {
  const scroll = useAutoScroll<HTMLDivElement>(enabled);
  return (
    <div
      data-testid="scroll"
      ref={scroll.ref}
      onMouseEnter={scroll.onMouseEnter}
      onMouseLeave={scroll.onMouseLeave}
      onFocus={scroll.onFocus}
      onBlur={scroll.onBlur}
    />
  );
}

// 设置容器的滚动尺寸：jsdom 不计算布局，需要手动定义
function sizeElement(element: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true });
}

describe('useAutoScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('内容溢出时向下滚动，到底后反向', () => {
    render(<Demo />);
    const element = screen.getByTestId('scroll');
    sizeElement(element, 100, 40);

    // 每秒 25 像素：40ms 走 1 像素
    vi.advanceTimersByTime(200);
    expect(element.scrollTop).toBe(5);

    // 到达底部后反向向上
    element.scrollTop = 60;
    vi.advanceTimersByTime(40);
    expect(element.scrollTop).toBe(60);
    vi.advanceTimersByTime(40);
    expect(element.scrollTop).toBe(59);
  });

  it('悬停或聚焦时暂停，移出后恢复', () => {
    render(<Demo />);
    const element = screen.getByTestId('scroll');
    sizeElement(element, 100, 40);

    fireEvent.mouseEnter(element);
    vi.advanceTimersByTime(200);
    expect(element.scrollTop).toBe(0);

    fireEvent.focus(element);
    vi.advanceTimersByTime(200);
    expect(element.scrollTop).toBe(0);

    fireEvent.mouseLeave(element);
    fireEvent.blur(element);
    vi.advanceTimersByTime(200);
    expect(element.scrollTop).toBe(5);
  });

  it('内容未溢出时不滚动', () => {
    render(<Demo />);
    const element = screen.getByTestId('scroll');
    sizeElement(element, 40, 40);

    vi.advanceTimersByTime(400);
    expect(element.scrollTop).toBe(0);
  });
});
