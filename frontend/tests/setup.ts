import '@ant-design/v5-patch-for-react-19';
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

// jsdom 未实现 Blob URL；图片上传的本地预览依赖它
function installObjectUrlStub(): void {
  // 已有实现时不覆盖
  if (typeof URL.createObjectURL === 'function') return;
  // 递增序号保证每次地址不同
  let counter = 0;
  URL.createObjectURL = () => `blob:test/${++counter}`;
  URL.revokeObjectURL = () => {};
}

// jsdom 未实现布局查询；tiptap/prosemirror 在输入后滚动选区会调用，返回零尺寸即可
function installLayoutStubs(): void {
  // 零尺寸矩形
  const zeroRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
  // 空矩形列表
  const emptyRects = {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  } as unknown as DOMRectList;
  if (typeof Range !== 'undefined') {
    Range.prototype.getClientRects = () => emptyRects;
    Range.prototype.getBoundingClientRect = () => zeroRect;
  }
  if (typeof document !== 'undefined' && typeof document.elementFromPoint !== 'function') {
    document.elementFromPoint = () => null;
  }
}

// 测试生命周期：启动 MSW、逐例重置、结束后关闭
beforeAll(() => {
  installMatchMediaStub();
  installObjectUrlStub();
  installLayoutStubs();
  server.listen({ onUnhandledRequest: 'error' });
  installRequestSignalCompat();
});
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
