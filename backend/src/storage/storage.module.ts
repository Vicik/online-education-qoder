import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/configuration';
import { FilesController } from './files.controller';
import { S3_CLIENT, StorageService } from './storage.service';

// 创建 S3 客户端：按 MinIO 配置初始化，forcePathStyle 兼容 MinIO 的路径式寻址
function createS3Client(config: ConfigService): S3Client {
  // 读取 MinIO 配置段
  const minio = config.get<AppConfig['minio']>('minio');
  return new S3Client({
    region: 'us-east-1', // MinIO 不校验区域，使用 S3 默认区域
    endpoint: minio?.endpoint || undefined, // 未配置时交给 SDK 默认端点（初始化阶段会被跳过）
    forcePathStyle: true, // MinIO 需要路径式访问：endpoint/bucket/key
    credentials: {
      accessKeyId: minio?.accessKey ?? '', // 访问密钥
      secretAccessKey: minio?.secretKey ?? '', // 私钥
    },
  });
}

// 文件存储模块：图片上传与签名访问
@Module({
  controllers: [FilesController], // 上传接口
  providers: [
    StorageService, // 上传/签名服务
    {
      provide: S3_CLIENT, // S3 客户端令牌
      inject: [ConfigService],
      useFactory: createS3Client,
    },
  ],
  exports: [StorageService], // 供课程封面/富文本等后续接入
})
export class StorageModule {}
