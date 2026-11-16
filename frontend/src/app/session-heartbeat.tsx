import { useCallback, useEffect, useRef } from 'react';
import { heartbeat } from '@/api/auth';
import { useSessionStore } from '@/stores/session';

// 心跳最小间隔：窗口内多次交互只发送一次
export const HEARTBEAT_INTERVAL_MS = 60_000;

// 会话心跳：监听真实交互并按 60 秒节流续期，空闲时不发送
export function SessionHeartbeat() {
  // 当前登录用户
  const user = useSessionStore((state) => state.user);
  // 上次心跳时间
  const lastSentRef = useRef(0);
  // 心跳请求是否进行中
  const sendingRef = useRef(false);
  // 最近一次心跳所属用户 id：切换账号时重置节流窗口
  const userIdRef = useRef<number | null>(null);

  // 发送心跳：登录态且无并发请求时才发送
  const send = useCallback(() => {
    if (!user || sendingRef.current) return;
    sendingRef.current = true;
    lastSentRef.current = Date.now();
    // 401 交给全局处理器跳登录；网络失败静默，等下一次交互重试
    void heartbeat()
      .catch(() => undefined)
      .finally(() => {
        sendingRef.current = false;
      });
  }, [user]);

  // 按最小间隔节流：频繁交互不放大请求量
  const maybeSend = useCallback(() => {
    if (!user) return;
    if (Date.now() - lastSentRef.current < HEARTBEAT_INTERVAL_MS) return;
    send();
  }, [send, user]);

  useEffect(() => {
    // 游客不监听，也不发心跳
    if (!user) {
      userIdRef.current = null;
      return undefined;
    }
    // 切换账号后立即重新开始节流窗口
    if (userIdRef.current !== user.id) {
      userIdRef.current = user.id ?? null;
      lastSentRef.current = 0;
    }
    // 页面加载/登录本身视为一次操作
    maybeSend();

    // 任意交互都尝试续期（内部节流）
    const handleActivity = () => maybeSend();
    // 回到前台补一次心跳：会话已过期时可立即触发跳登录
    const handleVisible = () => {
      if (document.visibilityState === 'visible') maybeSend();
    };

    window.addEventListener('pointerdown', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('wheel', handleActivity, { passive: true });
    window.addEventListener('touchstart', handleActivity, { passive: true });
    window.addEventListener('scroll', handleActivity, { capture: true, passive: true });
    document.addEventListener('visibilitychange', handleVisible);
    // 媒体播放算真实操作：在线课程长时间观看也能保持登录
    document.addEventListener('play', handleActivity, true);
    document.addEventListener('timeupdate', handleActivity, true);

    return () => {
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('wheel', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('scroll', handleActivity, true);
      document.removeEventListener('visibilitychange', handleVisible);
      document.removeEventListener('play', handleActivity, true);
      document.removeEventListener('timeupdate', handleActivity, true);
    };
  }, [maybeSend, user]);

  // 心跳组件不渲染任何内容
  return null;
}
