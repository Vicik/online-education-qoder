import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Logger,
  MethodNotAllowedException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { BizException } from '../exceptions/biz.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

function mockHost(requestId = 'req-1') {
  const captured = { statusCode: 0, body: '' };
  const response = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = JSON.stringify(payload);
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        headers: { 'x-request-id': requestId },
        method: 'POST',
        url: '/api/v1/orders',
      }),
    }),
  } as unknown as ArgumentsHost;
  return { host, captured };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('BizException 映射为统一响应包与语义化 HTTP 状态', () => {
    const { host, captured } = mockHost();
    filter.catch(new BizException(4001, '库存不足', 422), host);

    expect(captured.statusCode).toBe(422);
    expect(JSON.parse(captured.body)).toEqual({
      code: 4001,
      message: '库存不足',
      data: null,
      requestId: 'req-1',
    });
  });

  it('BizException 的 details 随响应返回', () => {
    const { host, captured } = mockHost();
    filter.catch(
      new BizException(7001, '命中屏蔽词', 422, { words: ['x'] }),
      host,
    );

    expect(JSON.parse(captured.body).data).toEqual({ words: ['x'] });
  });

  it('class-validator 错误映射 1001/400', () => {
    const { host, captured } = mockHost();
    filter.catch(
      new BadRequestException(['pageSize must not be greater than 100']),
      host,
    );

    expect(captured.statusCode).toBe(400);
    expect(JSON.parse(captured.body)).toMatchObject({ code: 1001, data: null });
  });

  it('未知异常映射 500/1006 且不泄露堆栈', () => {
    const { host, captured } = mockHost();
    filter.catch(new Error('connection string postgres://secret@host'), host);

    expect(captured.statusCode).toBe(500);
    const body = JSON.parse(captured.body);
    expect(body).toEqual({
      code: 1006,
      message: '服务器开小差了，请稍后重试',
      data: null,
      requestId: 'req-1',
    });
    expect(captured.body).not.toContain('stack');
    expect(captured.body).not.toContain('secret');
  });

  it('未知异常记录原始错误到日志', () => {
    const spy = jest.spyOn(Logger.prototype, 'error');
    const error = new Error('boom');
    filter.catch(error, mockHost().host);

    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0].join(' ')).toContain('boom');
  });

  it('非 Error 抛出物也映射 500', () => {
    const { host, captured } = mockHost();
    filter.catch('raw string failure', host);

    expect(captured.statusCode).toBe(500);
    expect(JSON.parse(captured.body).message).toBe(
      '服务器开小差了，请稍后重试',
    );
  });

  it.each([
    [new NotFoundException('找不到该路由'), 404, 1002],
    [new MethodNotAllowedException(), 405, 1003],
    [new PayloadTooLargeException(), 413, 1004],
    [new HttpException('慢一点', 429), 429, 1005],
    [new UnauthorizedException(), 401, 2001],
    [new ForbiddenException(), 403, 2002],
    [new HttpException('茶壶', 418), 418, 1001],
    [new ServiceUnavailableException(), 503, 1006],
  ])('框架异常 %p 保留状态 %i 并映射 code %i', (exception, status, code) => {
    const { host, captured } = mockHost();
    filter.catch(exception, host);

    expect(captured.statusCode).toBe(status);
    expect(JSON.parse(captured.body)).toMatchObject({
      code,
      data: null,
      requestId: 'req-1',
    });
  });
});
