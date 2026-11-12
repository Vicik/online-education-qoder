import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { StorageService } from './storage.service';

// 文件存储模块：图片上传与本地媒体签名访问（全局导出，课程/用户/社区读取时直接注入存储能力）
@Global()
@Module({
  controllers: [FilesController], // 图片上传接口
  providers: [StorageService], // 本地落盘与媒体签名服务
  exports: [StorageService], // 供封面、富文本、媒体读取等复用
})
export class StorageModule {}
