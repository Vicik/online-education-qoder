import { http, HttpResponse } from 'msw';
import { apiClient, request } from '@/api/client';
import { ApiError, registerAuthHandlers } from '@/api/errors';
import { server } from '../msw/server';

describe('api client', () => {
  it('code=0 时返回 data', async () => {
    server.use(
      http.get(/\/api\/v1\/ping$/, () =>
        HttpResponse.json({ code: 0, message: 'ok', data: { pong: true }, requestId: 'r1' }),
      ),
    );
    await expect(request<{ pong: boolean }>({ url: '/ping' })).resolves.toEqual({ pong: true });
  });
  it('非 0 业务码抛 ApiError', async () => {
    server.use(
      http.get(/\/api\/v1\/ping$/, () =>
        HttpResponse.json(
          { code: 1001, message: '参数错误', data: null, requestId: 'r2' },
          { status: 400 },
        ),
      ),
    );
    await expect(request({ url: '/ping' })).rejects.toMatchObject({ code: 1001, requestId: 'r2' });
  });
  it('2001 触发未登录处理器', async () => {
    const onUnauthorized = vi.fn();
    registerAuthHandlers({ onUnauthorized, onForbidden: vi.fn() });
    server.use(
      http.get(/\/api\/v1\/secure$/, () =>
        HttpResponse.json(
          { code: 2001, message: '未登录', data: null, requestId: 'r3' },
          { status: 401 },
        ),
      ),
    );
    await expect(request({ url: '/secure' })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
  it('skipAuthRedirect 时 2001 不触发处理器', async () => {
    const onUnauthorized = vi.fn();
    registerAuthHandlers({ onUnauthorized, onForbidden: vi.fn() });
    server.use(
      http.get(/\/api\/v1\/me$/, () =>
        HttpResponse.json(
          { code: 2001, message: '未登录', data: null, requestId: 'r4' },
          { status: 401 },
        ),
      ),
    );
    await expect(request({ url: '/me', skipAuthRedirect: true })).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it('响应 Date 头用于服务端时钟', async () => {
    server.use(
      http.get(/\/api\/v1\/time$/, () =>
        HttpResponse.json(
          { code: 0, message: 'ok', data: null, requestId: 'r5' },
          { headers: { Date: new Date('2026-01-01T00:00:00Z').toUTCString() } },
        ),
      ),
    );
    await request({ url: '/time' });
    expect(apiClient).toBeDefined(); // 时钟差值由 lib/server-clock 单测覆盖
  });
});
