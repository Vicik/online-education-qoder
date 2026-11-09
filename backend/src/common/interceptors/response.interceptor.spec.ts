import { ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

function mockCtx(headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function call(ctx: ExecutionContext, payload: unknown) {
  const interceptor = new ResponseInterceptor();
  return firstValueFrom(
    interceptor.intercept(ctx, { handle: () => of(payload) }),
  );
}

describe('ResponseInterceptor', () => {
  it('包装成功响应并附 requestId', async () => {
    await expect(
      call(mockCtx({ 'x-request-id': 'req-1' }), { a: 1 }),
    ).resolves.toEqual({
      code: 0,
      message: 'ok',
      data: { a: 1 },
      requestId: 'req-1',
    });
  });

  it('已带 code 的响应不二次包装', async () => {
    const envelope = {
      code: 0,
      message: 'ok',
      data: { a: 1 },
      requestId: 'req-1',
    };
    await expect(
      call(mockCtx({ 'x-request-id': 'req-2' }), envelope),
    ).resolves.toBe(envelope);
  });

  it('无返回体时 data 为 null', async () => {
    await expect(
      call(mockCtx({ 'x-request-id': 'req-1' }), undefined),
    ).resolves.toEqual({
      code: 0,
      message: 'ok',
      data: null,
      requestId: 'req-1',
    });
  });

  it('数组与普通标量原样放入 data', async () => {
    await expect(
      call(mockCtx({ 'x-request-id': 'req-1' }), [1, 2]),
    ).resolves.toMatchObject({
      code: 0,
      data: [1, 2],
    });
  });

  it('缺少请求头时 requestId 为空串而非 undefined', async () => {
    await expect(call(mockCtx(), { a: 1 })).resolves.toMatchObject({
      requestId: '',
    });
  });
});
