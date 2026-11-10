import { QueryClient } from '@tanstack/react-query';
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
