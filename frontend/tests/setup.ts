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

// jsdom 未实现 matchMedia；antd 的响应式 Grid（Form.Item 内部使用 Row）依赖它
function installMatchMediaStub(): void {
  // 已有实现时不覆盖
  if (typeof window.matchMedia === 'function') return;
  // 固定返回「不匹配」，响应式断点按最小屏处理
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

// 测试生命周期：启动 MSW、逐例重置、结束后关闭
beforeAll(() => {
  installMatchMediaStub();
  server.listen({ onUnhandledRequest: 'error' });
  installRequestSignalCompat();
});
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
