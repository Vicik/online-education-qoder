import { flushSync } from 'react-dom';

// RouterProvider 的 flushSync 适配器：其类型要求返回 undefined，而 ReactDOM.flushSync 返回回调结果
export function routerFlushSync(fn: () => unknown): undefined {
  flushSync(fn);
  return undefined;
}
