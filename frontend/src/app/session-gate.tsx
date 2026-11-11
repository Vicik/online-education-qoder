import { useQuery } from '@tanstack/react-query';
import { Spin } from 'antd';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { getMe } from '@/api/auth';
import { queryKeys } from '@/api/query-keys';
import { useSessionStore } from '@/stores/session';

// 启动时探测一次会话；失败按游客处理
export function SessionGate({ children }: PropsWithChildren) {
  const setUser = useSessionStore((state) => state.setUser);
  // 会话是否已写入 Store：未同步前渲染子路由会读到游客态并误跳登录
  const [synced, setSynced] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.authMe,
    queryFn: getMe,
    retry: false,
    staleTime: 60_000,
  });

  // 探测结束后写入会话 Store；成功与失败都视为已同步
  useEffect(() => {
    if (query.isLoading) return;
    setUser(query.data ?? null);
    setSynced(true);
  }, [query.data, query.isLoading, setUser]);

  if (query.isLoading || !synced) {
    return (
      <div className="full-page-loading">
        <Spin size="large" />
      </div>
    );
  }
  return <>{children}</>;
}
