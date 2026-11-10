import { useCallback, useRef } from 'react';

// 点击守卫：冷却期内的重复触发（双击、鼠标故障）只执行一次
export function useClickGuard<TArgs extends unknown[]>(
  handler: (...args: TArgs) => void,
  cooldownMs = 800,
): (...args: TArgs) => void {
  // 上次成功触发的时间戳；同步判断，避免快速接口下重复执行
  const lastTriggeredAtRef = useRef(0);
  // 始终引用最新 handler，避免闭包捕获过期状态
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  return useCallback(
    (...args: TArgs) => {
      const now = Date.now();
      if (now - lastTriggeredAtRef.current < cooldownMs) return;
      lastTriggeredAtRef.current = now;
      handlerRef.current(...args);
    },
    [cooldownMs],
  );
}
