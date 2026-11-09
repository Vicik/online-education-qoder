import { HttpException } from '@nestjs/common';

// 业务异常类：用于抛出自定义业务错误，携带业务错误码和详细信息
export class BizException extends HttpException {
  // 构造函数：初始化业务异常
  constructor(
    public readonly bizCode: number, // 业务错误码
    message: string, // 错误消息
    httpStatus: number = 400, // HTTP 状态码，默认 400
    public readonly details?: unknown, // 可选的详细错误信息
  ) {
    super(message, httpStatus);
  }
}
