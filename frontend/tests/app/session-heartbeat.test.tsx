import { cleanup, render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_INTERVAL_MS, SessionHeartbeat } from '@/app/session-heartbeat';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';

// 等待毫秒
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SessionHeartbeat', () => {
  // 心跳请求次数
  let calls = 0;
  // 可控的当前时间
  let now = 1_000_000;

  beforeEach(() => {
    calls = 0;
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    useSessionStore.setState({ user: null });
    server.use(
      http.post(/\/api\/v1\/auth\/heartbeat$/, () => {
        calls += 1;
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: null,
          requestId: 'r-heartbeat',
        });
      }),
    );
  });

  afterEach(() => {
    // 先卸载组件再清空会话，避免已挂载组件收到脱离 act 的更新
    cleanup();
    vi.restoreAllMocks();
    useSessionStore.getState().clear();
  });

  it('游客不发送心跳', async () => {
    render(<SessionHeartbeat />);
    window.dispatchEvent(new Event('pointerdown'));
    await sleep(30);
    expect(calls).toBe(0);
  });

  it('登录后立即心跳，60 秒内重复交互不放大请求', async () => {
    useSessionStore.setState({ user: { id: 1, role: 'user' } });
    render(<SessionHeartbeat />);

    await vi.waitFor(() => expect(calls).toBe(1));
    window.dispatchEvent(new Event('pointerdown'));
    await sleep(30);
    expect(calls).toBe(1);

    now += HEARTBEAT_INTERVAL_MS + 1;
    window.dispatchEvent(new Event('keydown'));
    await vi.waitFor(() => expect(calls).toBe(2));
  });

  it('媒体播放事件也算交互，卸载后不再续期', async () => {
    useSessionStore.setState({ user: { id: 1, role: 'user' } });
    const view = render(<SessionHeartbeat />);
    await vi.waitFor(() => expect(calls).toBe(1));

    now += HEARTBEAT_INTERVAL_MS + 1;
    document.dispatchEvent(new Event('timeupdate'));
    await vi.waitFor(() => expect(calls).toBe(2));

    view.unmount();
    now += HEARTBEAT_INTERVAL_MS + 1;
    window.dispatchEvent(new Event('pointerdown'));
    await sleep(30);
    expect(calls).toBe(2);
  });
});
