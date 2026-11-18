import { http, HttpResponse, type RequestHandler } from 'msw';

// 默认接口桩：心跳是全局静默请求，未单独断言的用例统一返回成功
export const handlers: RequestHandler[] = [
  http.post(/\/api\/v1\/auth\/heartbeat$/, () =>
    HttpResponse.json({ code: 0, message: 'ok', data: null, requestId: 'r-heartbeat' }),
  ),
  // 宣传位列表：未单独断言的用例统一返回空宣传位
  http.get(/\/api\/v1\/admin\/courses\/promotion$/, () =>
    HttpResponse.json({ code: 0, message: 'ok', data: [], requestId: 'r-promotion' }),
  ),
];
