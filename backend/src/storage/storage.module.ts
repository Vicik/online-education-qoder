import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { diskStorage } from 'multer';
import type { AppConfig } from '../config/configuration';
import { AdminFilesController } from './admin-files.controller';
import { FilesController } from './files.controller';
import { MediaController } from './media.controller';
import { StorageService } from './storage.service';

// 文件存储模块：图片上传、媒体上传与签名读取（全局导出）
@Global()
@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        // 读取上传配置
        const upload = config.get<AppConfig['upload']>('upload')!;
        // 临时目录：音视频先流式落盘
        const tmpDir = join(upload.dir, 'tmp');
        await mkdir(tmpDir, { recursive: true });
        return {
          storage: diskStorage({
            destination: tmpDir,
            // 临时文件名：随机 UUID，避免并发上传互相覆盖
            filename: (_request, _file, callback) => {
              callback(null, `${randomUUID()}.part`);
            },
          }),
          limits: { files: 1, fileSize: upload.videoMaxBytes },
        };
      },
    }),
  ],
  controllers: [FilesController, AdminFilesController, MediaController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
