import {
  ArgumentsHost,
  Catch,
  Controller,
  ExceptionFilter,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { MAX_IMAGE_BYTES, StorageService } from './storage.service';

// 上传体积超限过滤器：multer 抛 413，按接口契约改写为 422/code=1001
@Catch(PayloadTooLargeException)
class UploadTooLargeFilter implements ExceptionFilter {
  // 复用全局过滤器，保证响应包格式一致
  private readonly delegate = new AllExceptionsFilter();

  // 异常处理方法：把 413 转为业务异常后交给全局过滤器输出
  catch(_exception: unknown, host: ArgumentsHost): void {
    this.delegate.catch(
      new BizException(ErrorCode.PARAM_INVALID, '图片不能超过 2MB', 422),
      host,
    );
  }
}

// 文件接口控制器：登录用户上传图片
@Controller('files')
export class FilesController {
  // 构造函数：注入存储服务
  constructor(private readonly storage: StorageService) {}

  // 图片上传：FileInterceptor 默认内存缓冲 + 2MB 硬限制，校验后重编码入私有桶
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 }, // 单文件 ≤2MB
    }),
  )
  @UseFilters(UploadTooLargeFilter)
  upload(@UploadedFile() file?: Express.Multer.File) {
    // 未携带文件时给出明确提示
    if (!file) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '请选择要上传的图片',
        400,
      );
    }
    return this.storage.uploadImage({
      buffer: file.buffer, // 文件内容
      mimeType: file.mimetype, // 客户端声明的 MIME
      originalName: file.originalname, // 原始文件名
    });
  }
}
