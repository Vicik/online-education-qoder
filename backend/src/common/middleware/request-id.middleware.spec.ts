import { Request, Response } from 'express';
import { RequestIdMiddleware } from './request-id.middleware';

function run(headers: Record<string, string> = {}) {
  const req = { headers } as unknown as Request;
  const res = { setHeader: jest.fn() } as unknown as Response;
  const next = jest.fn();
  new RequestIdMiddleware().use(req, res, next);
  return {
    req,
    res,
    next,
    id: (res.setHeader as jest.Mock).mock.calls[0]?.[1] as string,
  };
}

describe('RequestIdMiddleware', () => {
  it('无 X-Request-Id 时生成 req-<ulid> 并回写响应头', () => {
    const { res, next, id } = run();

    expect(id).toMatch(/^req-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('生成的 id 写回请求头供下游读取', () => {
    const { req, id } = run();
    expect(req.headers['x-request-id']).toBe(id);
  });

  it('连续生成的 id 不重复', () => {
    expect(run().id).not.toBe(run().id);
  });

  it('沿用入站合法 X-Request-Id', () => {
    const { req, res, id } = run({ 'x-request-id': 'gateway-abc-123' });

    expect(id).toBe('gateway-abc-123');
    expect(req.headers['x-request-id']).toBe('gateway-abc-123');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      'gateway-abc-123',
    );
  });

  it('入站 id 含非法字符时改为服务端生成，避免响应头注入', () => {
    const { id } = run({ 'x-request-id': 'bad\r\nX-Injected: 1' });
    expect(id).toMatch(/^req-[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('入站 id 超长时改为服务端生成', () => {
    const { id } = run({ 'x-request-id': 'a'.repeat(129) });
    expect(id).toMatch(/^req-[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
