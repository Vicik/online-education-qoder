import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCode } from '../constants/error-codes';
import { BizException } from '../exceptions/biz.exception';

// 内部错误默认消息：当发生未预期异常时返回给客户端的通用提示
const INTERNAL_MESSAGE = '服务器开小差了，请稍后重试';

// HTTP 状态码到业务错误码的映射表
const STATUS_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.PARAM_INVALID, // 参数无效
  401: ErrorCode.UNAUTHORIZED, // 未授权
  403: ErrorCode.FORBIDDEN, // 禁止访问
  404: ErrorCode.RESOURCE_NOT_FOUND, // 资源未找到
  405: ErrorCode.METHOD_NOT_ALLOWED, // 方法不允许
  413: ErrorCode.PAYLOAD_TOO_LARGE, // 请求体过大
  429: ErrorCode.RATE_LIMITED, // 请求限流
  500: ErrorCode.INTERNAL_ERROR, // 内部错误
};

// 根据 HTTP 状态码获取对应的业务错误码
function codeForStatus(status: number): ErrorCode {
  // 优先从映射表查找，未命中时 5xx 返回内部错误，其他返回参数无效
  return (
    STATUS_CODES[status] ??
    (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.PARAM_INVALID)
  );
}

// 从 HTTP 异常中提取验证错误消息
function validationMessage(exception: HttpException): string {
  // 获取异常响应体
  const response = exception.getResponse();
  // 如果响应是字符串，直接返回
  if (typeof response === 'string') return response;
  // 提取 message 字段，可能是字符串或字符串数组
  const message = (response as { message?: string | string[] }).message;
  // 如果是数组，用分号连接
  if (Array.isArray(message)) return message.join('; ');
  // 返回消息或异常原始消息
  return message ?? exception.message;
}

// 全局异常过滤器：捕获所有异常并统一格式化返回给客户端
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  // 日志记录器：用于记录未处理异常的堆栈信息
  private readonly logger = new Logger(AllExceptionsFilter.name);

  // 异常处理方法：将异常转换为统一的 JSON 响应格式
  catch(exception: unknown, host: ArgumentsHost): void {
    // 获取 HTTP 上下文
    const http = host.switchToHttp();
    // 获取响应对象
    const response = http.getResponse<Response>();
    // 获取请求对象
    const request = http.getRequest<Request>();
    // 从请求头获取请求 ID
    const header = request.headers['x-request-id'];
    // 请求 ID，用于追踪
    const requestId = typeof header === 'string' ? header : '';

    // 默认 HTTP 状态码
    let status = 500;
    // 默认业务错误码
    let code: number = ErrorCode.INTERNAL_ERROR;
    // 默认错误消息
    let message = INTERNAL_MESSAGE;
    // 默认错误详情
    let data: unknown = null;

    // 处理业务异常：使用异常自带的业务错误码和消息
    if (exception instanceof BizException) {
      status = exception.getStatus();
      code = exception.bizCode;
      message = exception.message;
      data = exception.details ?? null;
    } else if (exception instanceof HttpException) {
      // 处理 HTTP 异常：根据状态码映射业务错误码，提取验证消息
      status = exception.getStatus();
      code = codeForStatus(status);
      message = validationMessage(exception);
    } else {
      // 处理未预期异常：记录错误日志，返回默认消息
      this.logger.error(
        `${request.method} ${request.url} 未处理异常`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // 返回统一格式的 JSON 响应
    response.status(status).json({ code, message, data, requestId });
  }
}
