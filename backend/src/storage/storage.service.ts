import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import type { AppConfig } from '../config/configuration';
import { detectImageType, type ImageType } from './image-validator.util';

// S3 客户端注入令牌：隔离具体 S3Client 实例，便于测试替换
export const S3_CLIENT = 'S3_CLIENT';
// 单张图片体积上限：2MB
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// 签名 GET URL 默认有效期：15 分钟
export const DEFAULT_IMAGE_URL_TTL_SEC = 900;

// 图片类型到标准 MIME 的映射
const MIME_BY_TYPE: Record<ImageType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
// 图片类型到对象存储扩展名的映射（JPEG 统一用 .jpg）
const EXT_BY_TYPE: Record<ImageType, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
};

// uploadImage 入参：内存中的上传文件
export interface UploadImageInput {
  buffer: Buffer; // 文件内容
  mimeType: string; // 客户端声明的 Content-Type
  originalName: string; // 原始文件名（仅用于日志/审计，不参与存储 key）
}

// 上传结果：对象存储 key 与可直接访问的签名 URL
export interface UploadData {
  key: string; // 对象存储 key
  url: string; // 15 分钟签名 GET URL
}

// 对象存储服务：封装 S3 协议（MinIO 兼容）上传与签名访问
@Injectable()
export class StorageService implements OnModuleInit {
  // 日志记录器：记录桶初始化与存储异常
  private readonly logger = new Logger(StorageService.name);

  // 构造函数：注入 S3 客户端与配置服务
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: ConfigService,
  ) {}

  // 模块初始化钩子：桶不存在时自动创建（幂等）；未配置端点则跳过，避免阻断无存储环境启动
  async onModuleInit(): Promise<void> {
    // 读取 MinIO 配置
    const minio = this.minio();
    // 未配置端点时不访问网络，存储能力交由具体接口在调用时失败
    if (!minio.endpoint) {
      this.logger.warn('未配置 MINIO_ENDPOINT，跳过存储桶初始化');
      return;
    }
    try {
      // 先探测桶是否存在
      await this.s3.send(new HeadBucketCommand({ Bucket: minio.bucket }));
    } catch (error) {
      // 仅对「桶不存在」自动创建；其余错误（网络/鉴权）记录告警但不阻断应用启动
      const name = (error as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchBucket') {
        await this.s3.send(new CreateBucketCommand({ Bucket: minio.bucket }));
        this.logger.log(`已创建存储桶 ${minio.bucket}`);
        return;
      }
      this.logger.warn(`存储桶检查失败：${(error as Error).message}`);
    }
  }

  // 上传图片：体积/MIME/magic bytes 校验 → sharp 重编码去 EXIF → 写入私有桶 → 返回签名 URL
  async uploadImage(file: UploadImageInput): Promise<UploadData> {
    // 应用层兜底体积校验（实际请求由 multer 先行限制）
    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new BizException(ErrorCode.PARAM_INVALID, '图片不能超过 2MB', 422);
    }

    // 以文件头识别真实类型，不信任扩展名
    const type = detectImageType(file.buffer);
    // 客户端声明的 MIME 必须与真实类型一致
    if (file.mimeType !== MIME_BY_TYPE[type]) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '图片内容与类型不符',
        422,
      );
    }

    // 重编码：rotate() 按 EXIF 方向摆正，sharp 输出默认不携带元数据（去 EXIF）
    const pipeline = sharp(file.buffer).rotate();
    // 按类型选择编码器并输出 Buffer
    const cleaned = await (
      type === 'png'
        ? pipeline.png()
        : type === 'jpeg'
          ? pipeline.jpeg()
          : pipeline.webp()
    ).toBuffer();

    // 存储 key：桶名/年/月/UUID.扩展名，避免文件名冲突与路径注入
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `${this.minio().bucket}/${yyyy}/${mm}/${randomUUID()}.${EXT_BY_TYPE[type]}`;

    // 写入私有桶，ContentType 使用校验后的真实 MIME
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.minio().bucket,
        Key: key,
        Body: cleaned,
        ContentType: MIME_BY_TYPE[type],
      }),
    );

    // 返回短期签名 URL 供前端直接展示
    const url = await this.presignGet(key);
    return { key, url };
  }

  // 生成签名 GET URL：默认 15 分钟，可按展示场景覆盖
  async presignGet(
    key: string,
    expiresInSec: number = DEFAULT_IMAGE_URL_TTL_SEC,
  ): Promise<string> {
    // 使用 S3 签名器为私有对象生成临时访问链接
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.minio().bucket, Key: key }),
      { expiresIn: expiresInSec },
    );
  }

  // 读取 MinIO 配置段
  private minio(): AppConfig['minio'] {
    return this.config.get<AppConfig['minio']>('minio')!;
  }
}
