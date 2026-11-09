import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';

// 响应信封接口：定义统一的 API 响应格式
export interface Envelope<T> {
  code: number; // 业务错误码，0 表示成功
  message: string; // 响应消息
  data: T; // 响应数据
  requestId: string; // 请求追踪 ID
}

// 判断值是否已经是响应信封格式：检查是否包含 code 字段
function isEnvelope(value: unknown): value is Envelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'number'
  );
}

// 响应拦截器：将控制器返回值包装为统一的 JSON 响应格式
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  // 拦截方法：处理响应数据，确保返回统一的信封格式
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // 获取 HTTP 请求对象
    const request = context.switchToHttp().getRequest<Request>();
    // 从请求头获取请求 ID
    const header = request.headers['x-request-id'];
    // 请求 ID，用于追踪
    const requestId = typeof header === 'string' ? header : '';

    // 处理响应流，将数据包装为统一格式
    return next.handle().pipe(
      map((data: unknown) => {
        // 如果数据已经是信封格式，直接返回
        if (isEnvelope(data)) return data;
        // 包装为统一的响应格式
        return {
          code: 0, // 成功状态码
          message: 'ok', // 成功消息
          data: data ?? null, // 响应数据，null 时返回 null
          requestId, // 请求追踪 ID
        } satisfies Envelope<unknown>;
      }),
    );
  }
}
