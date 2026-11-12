import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';

// 上传体积超限过滤器：multer 抛 413，按接口契约改写为 422/code=1001
@Catch(PayloadTooLargeException)
export class UploadTooLargeFilter implements ExceptionFilter {
  // 复用全局过滤器，保证响应包格式一致
  private readonly delegate = new AllExceptionsFilter();

  // 构造函数：接收面向用户的提示文案
  constructor(private readonly message: string) {}

  // 异常处理：413 转为业务异常后交给全局过滤器
  catch(_exception: unknown, host: ArgumentsHost): void {
    this.delegate.catch(
      new BizException(ErrorCode.PARAM_INVALID, this.message, 422),
      host,
    );
  }
}
