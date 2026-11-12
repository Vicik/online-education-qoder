import {
  Controller,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { MAX_IMAGE_BYTES, StorageService } from './storage.service';
import { UploadTooLargeFilter } from './upload-too-large.filter';

// 文件接口控制器：登录用户上传图片
@Controller('files')
export class FilesController {
  // 构造函数：注入存储服务
  constructor(private readonly storage: StorageService) {}

  // 图片上传：内存缓冲 + 2MB 硬限制
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    }),
  )
  @UseFilters(new UploadTooLargeFilter('图片不能超过 2MB'))
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
      buffer: file.buffer,
      mimeType: file.mimetype,
    });
  }
}
