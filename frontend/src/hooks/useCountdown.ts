import { useEffect, useRef, useState } from 'react';
import { serverNow } from '@/lib/server-clock';

// 基于服务端时间的倒计时：返回剩余毫秒，到期只触发一次回调
export function useCountdown(
  deadlineAt: string | null | undefined,
  onExpire?: () => void,
): number {
  // 剩余毫秒（不为负）
  const [remainingMs, setRemainingMs] = useState(0);
  // 是否已触发到期回调，保证只回调一次
  const expiredRef = useRef(false);
  // 回调引用：避免 onExpire 变化重建定时器
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    expiredRef.current = false;
    if (!deadlineAt) {
      setRemainingMs(0);
      return undefined;
    }
    // 截止时间戳（UTC 解析）
    const deadlineMs = new Date(deadlineAt).getTime();
    // 每次 tick 用服务端校准时间重算，避免客户端时钟漂移
    const tick = () => {
      const next = Math.max(0, deadlineMs - serverNow());
      setRemainingMs(next);
      if (next === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current?.();
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  return remainingMs;
}
