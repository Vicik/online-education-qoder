import { RouterProvider } from 'react-router';
import { RequestOverlay } from '@/components/common/RequestOverlay';
import { AppProviders } from './app/providers';
import { router } from './app/router';

// 应用入口：Provider + 浏览器路由 + 全局请求遮罩
export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
      <RequestOverlay />
    </AppProviders>
  );
}
