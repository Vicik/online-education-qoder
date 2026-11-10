import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { ApiError } from '@/api/errors';
import { newIdempotencyKey } from '@/api/idempotency';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';

// 测试用 QueryClient
function createWrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useIdempotentMutation', () => {
  it('生成 8–128 长度且唯一的 key', () => {
    const first = newIdempotencyKey();
    const second = newIdempotencyKey();
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(first).not.toBe(second);
  });
  it('失败重试复用同一 key，成功后重置', async () => {
    const keys: string[] = [];
    const mutationFn = vi.fn(async (_variables: { id: number }, key: string) => {
      keys.push(key);
      if (keys.length === 1) throw new ApiError(1006, 'down', null, 'r', 500);
      return { ok: true };
    });
    const { result } = renderHook(
      () => useIdempotentMutation<{ ok: boolean }, { id: number }>(mutationFn),
      { wrapper: createWrapper() },
    );
    await expect(result.current.mutateAsync({ id: 1 })).rejects.toBeInstanceOf(ApiError);
    await result.current.mutateAsync({ id: 1 });
    await result.current.mutateAsync({ id: 1 });
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});
