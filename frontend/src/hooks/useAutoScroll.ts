import { useEffect, useRef } from 'react';

// 自动滚动：容器内容溢出时逐像素上下往返，悬停或聚焦时暂停
export function useAutoScroll<T extends HTMLElement>(enabled = true, stepMs = 40) {
  // 滚动容器引用
  const ref = useRef<T>(null);
  // 是否暂停：由悬停/聚焦事件写入，不触发重渲染
  const pausedRef = useRef(false);

  useEffect(() => {
    // 未启用或无容器时不滚动
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    // 当前方向：1 向下，-1 向上
    let direction = 1;
    // 每 40ms 移动 1px，约 25px/s
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;
      // 可滚动距离：内容未溢出时为 0
      const max = element.scrollHeight - element.clientHeight;
      if (max <= 0) return;
      const next = element.scrollTop + direction;
      if (next >= max) {
        // 到底后反向向上
        element.scrollTop = max;
        direction = -1;
      } else if (next <= 0) {
        // 到顶后反向向下
        element.scrollTop = 0;
        direction = 1;
      } else {
        element.scrollTop = next;
      }
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [enabled, stepMs]);

  // 暂停：鼠标移入或获得焦点
  const pause = () => {
    pausedRef.current = true;
  };
  // 恢复：鼠标移出或失去焦点
  const resume = () => {
    pausedRef.current = false;
  };

  return {
    ref,
    onMouseEnter: pause,
    onMouseLeave: resume,
    onFocus: pause,
    onBlur: resume,
  };
}
