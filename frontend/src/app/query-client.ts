import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/api/query-keys';
import { ApiError } from '@/api/errors';

// 全局 QueryClient：缓存 30 秒；GET 失败最多重试一次；写操作不自动重试
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

// 清空用户域缓存；保留 auth-me 供 SessionGate 的观察者继续订阅，
// clear() 会让该观察者脱离缓存，导致再次登录后无法回填昵称/头像
export function clearSessionQueries(client: QueryClient = queryClient): void {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
  client.setQueryData(queryKeys.authMe, null);
}
