import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { PropsWithChildren } from 'react';
import { useFavoriteToggle } from '@/hooks/useFavorites';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-hook' };
}

// 收藏课程桩
function course(id: number) {
  return {
    id,
    name: `课程 ${id}`,
    type: 'video',
    coverKey: null,
    coverUrl: null,
    instructor: '讲师',
    originalCents: 10000,
    saleCents: 9000,
    status: 'published',
  };
}

// 收藏接口桩：GET 返回指定课程，POST/DELETE 记录调用
function mockFavorites(items: ReturnType<typeof course>[]) {
  // 删除请求次数
  let deleted = 0;
  // GET 查询次数
  let fetched = 0;
  // 删除后是否返回空列表
  let removed = false;
  // 收藏请求体
  const posted: Array<{ courseId?: number; key: string }> = [];
  server.use(
    http.get(/\/api\/v1\/user\/favorites$/, () => {
      fetched += 1;
      const current = removed ? [] : items;
      return HttpResponse.json(
        envelope({ items: current, total: current.length, page: 1, pageSize: 100 }),
      );
    }),
    http.post(/\/api\/v1\/favorites$/, async ({ request }) => {
      posted.push({
        ...((await request.json()) as { courseId?: number }),
        key: request.headers.get('idempotency-key') ?? '',
      });
      return HttpResponse.json(envelope(null), { status: 201 });
    }),
    http.delete(/\/api\/v1\/favorites\/1$/, () => {
      deleted += 1;
      removed = true;
      return HttpResponse.json(envelope(null));
    }),
  );
  return {
    // 已执行删除次数
    get deleted() {
      return deleted;
    },
    // 已执行收藏请求
    get posted() {
      return posted;
    },
    // 已执行查询次数
    get fetched() {
      return fetched;
    },
  };
}

// 测试包装：独立 QueryClient
function wrapper({ children }: PropsWithChildren) {
  // 每个用例独立缓存
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useFavoriteToggle', () => {
  beforeEach(() => {
    useSessionStore.getState().setUser({ id: 2, role: 'user' } as never);
  });

  afterEach(() => {
    // 先卸载组件再清空登录态，避免已挂载组件在 act 外更新
    cleanup();
    useSessionStore.getState().clear();
  });

  it('已收藏课程切换为取消收藏，调用 DELETE', async () => {
    const calls = mockFavorites([course(1)]);
    const { result } = renderHook(() => useFavoriteToggle(1), { wrapper });

    await waitFor(() => expect(result.current.favorited).toBe(true));
    await act(async () => {
      await result.current.toggle();
    });

    expect(calls.deleted).toBe(1);
    await waitFor(() => expect(result.current.favorited).toBe(false));
  });

  it('未收藏课程切换为收藏，携带 Idempotency-Key', async () => {
    const calls = mockFavorites([]);
    const { result } = renderHook(() => useFavoriteToggle(1), { wrapper });

    await waitFor(() => expect(calls.fetched).toBeGreaterThan(0));
    await act(async () => {
      await result.current.toggle();
    });

    expect(calls.posted).toHaveLength(1);
    expect(calls.posted[0].courseId).toBe(1);
    expect(calls.posted[0].key).not.toBe('');
    // 成功后失效收藏缓存并重新查询
    await waitFor(() => expect(calls.fetched).toBeGreaterThan(1));
  });
});
