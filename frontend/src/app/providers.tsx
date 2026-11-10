import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, type PropsWithChildren } from 'react';
import { registerAuthHandlers } from '@/api/errors';
import { useSessionStore } from '@/stores/session';
import { APP_THEME_TOKEN } from '@/styles/theme';
import { queryClient } from './query-client';
import { SessionGate } from './session-gate';

// 应用级 Provider：主题、消息上下文、Query、会话引导、全局错误跳转
export function AppProviders({ children }: PropsWithChildren) {
  // 全局 2001/2002：清会话并整页跳转，避免路由层状态不一致
  useEffect(() => {
    registerAuthHandlers({
      onUnauthorized: () => {
        useSessionStore.getState().clear();
        queryClient.clear();
        const current = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/login?redirect=${encodeURIComponent(current)}`);
      },
      onForbidden: () => window.location.assign('/403'),
    });
  }, []);

  return (
    <ConfigProvider locale={zhCN} theme={{ token: APP_THEME_TOKEN }}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <SessionGate>{children}</SessionGate>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  );
}
