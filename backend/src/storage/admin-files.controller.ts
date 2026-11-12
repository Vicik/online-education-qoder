import {
  Controller,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { Roles } from '../common/decorators/roles.decorator';
import type { MediaKind } from './media-validator.util';
import { StorageService } from './storage.service';
import { UploadTooLargeFilter } from './upload-too-large.filter';

// 管理端文件上传：音视频仅管理员可用
@Controller('admin/files')
@Roles('admin')
export class AdminFilesController {
  // 构造函数：注入存储服务
  constructor(private readonly storage: StorageService) {}

  // 上传视频
  @Post('video')
  @UseInterceptors(FileInterceptor('file'))
  @UseFilters(new UploadTooLargeFilter('视频超过上传上限'))
  uploadVideo(@UploadedFile() file?: Express.Multer.File) {
    return this.save(file, 'video');
  }

  // 上传音频
  @Post('audio')
  @UseInterceptors(FileInterceptor('file'))
  @UseFilters(new UploadTooLargeFilter('音频超过上传上限'))
  uploadAudio(@UploadedFile() file?: Express.Multer.File) {
    return this.save(file, 'audio');
  }

  // 统一校验文件并交给存储服务（异步：缺失文件也走 rejected Promise）
  private async save(file: Express.Multer.File | undefined, kind: MediaKind) {
    if (!file) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '请选择要上传的文件',
        400,
      );
    }
    return this.storage.saveMedia({ tempPath: file.path, kind });
  }
}
