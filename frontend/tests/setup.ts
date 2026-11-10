import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw/server';

// dayjs 全局插件：UTC 解析与 Asia/Shanghai 时区换算
dayjs.extend(utc);
dayjs.extend(timezone);

// 测试生命周期：启动 MSW、逐例重置、结束后关闭
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
