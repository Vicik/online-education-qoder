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

// jsdom 的 AbortSignal 无法通过 Node Request 的 webidl 校验；React Router 导航会构造 Request，
// 测试不依赖导航取消信号，因此在构造时剥离 signal。必须在 MSW 安装拦截器之后覆盖。
function installRequestSignalCompat(): void {
  // MSW 安装拦截器后的当前 Request 实现
  const BaseRequest = globalThis.Request;
  // 兼容包装：移除 jsdom AbortSignal
  class CompatRequest extends BaseRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init?.signal ? { ...init, signal: undefined } : init);
    }
  }
  globalThis.Request = CompatRequest as unknown as typeof Request;
}

// 测试生命周期：启动 MSW、逐例重置、结束后关闭
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  installRequestSignalCompat();
});
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
