// 服务端与本地时钟差值（毫秒）
let offsetMs = 0;
// 订阅者集合：时钟校正后通知倒计时刷新
const listeners = new Set<() => void>();

// 用响应 Date 头校正服务端时钟
export function syncServerClock(dateHeader?: string): void {
  if (!dateHeader) return;
  const serverMs = Date.parse(dateHeader);
  if (Number.isNaN(serverMs)) return;
  const nextOffset = serverMs - Date.now();
  if (Math.abs(nextOffset - offsetMs) < 1000) return;
  offsetMs = nextOffset;
  listeners.forEach((listener) => listener());
}

// 订阅时钟变化（useSyncExternalStore 使用）
export function subscribeServerClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 当前服务端时间偏移
export function getServerOffsetMs(): number {
  return offsetMs;
}

// 校准后的服务端当前时间
export function serverNow(): number {
  return Date.now() + offsetMs;
}
