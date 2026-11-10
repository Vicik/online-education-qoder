import { useSyncExternalStore } from 'react';
import { getServerOffsetMs, serverNow, subscribeServerClock } from '@/lib/server-clock';

// 暴露服务端时钟偏移与校准后的 now()
export function useServerClock(): { offsetMs: number; now: () => number } {
  const offsetMs = useSyncExternalStore(subscribeServerClock, getServerOffsetMs, () => 0);
  return { offsetMs, now: serverNow };
}
