import { useQuery } from '@tanstack/react-query';
import { Spin } from 'antd';
import { useEffect, type PropsWithChildren } from 'react';
import { getMe } from '@/api/auth';
import { queryKeys } from '@/api/query-keys';
import { useSessionStore } from '@/stores/session';

// 启动时探测一次会话；失败按游客处理
export function SessionGate({ children }: PropsWithChildren) {
  const setUser = useSessionStore((state) => state.setUser);
  const query = useQuery({
    queryKey: queryKeys.authMe,
    queryFn: getMe,
    retry: false,
    staleTime: 60_000,
  });

  // 探测结果写入会话 Store；失败即游客
  useEffect(() => {
    setUser(query.data ?? null);
  }, [query.data, setUser]);

  if (query.isLoading) {
    return (
      <div className="full-page-loading">
        <Spin size="large" />
      </div>
    );
  }
  return <>{children}</>;
}
