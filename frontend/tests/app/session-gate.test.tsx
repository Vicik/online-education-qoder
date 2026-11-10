import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { PropsWithChildren } from 'react';
import { SessionGate } from '@/app/session-gate';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';

// 测试包装：独立 QueryClient
function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('SessionGate', () => {
  it('401 时按游客渲染子节点', async () => {
    server.use(
      http.get(/\/api\/v1\/auth\/me$/, () =>
        HttpResponse.json(
          { code: 2001, message: '未登录', data: null, requestId: 'r' },
          { status: 401 },
        ),
      ),
    );
    render(
      <SessionGate>
        <div>guest-content</div>
      </SessionGate>,
      { wrapper },
    );
    expect(await screen.findByText('guest-content')).toBeInTheDocument();
    expect(useSessionStore.getState().user).toBeNull();
  });

  it('200 时写入会话 Store', async () => {
    server.use(
      http.get(/\/api\/v1\/auth\/me$/, () =>
        HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { id: 1, email: 'u@example.com', nickname: '学员', role: 'user' },
          requestId: 'r2',
        }),
      ),
    );
    render(
      <SessionGate>
        <div>user-content</div>
      </SessionGate>,
      { wrapper },
    );
    expect(await screen.findByText('user-content')).toBeInTheDocument();
    expect(useSessionStore.getState().user?.role).toBe('user');
  });
});
