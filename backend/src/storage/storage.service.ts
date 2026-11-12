import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { open, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import {
  applyImageUrls,
  collectImageKeys,
} from '../common/utils/media.util';
import type { AppConfig } from '../config/configuration';
import { detectImageType, type ImageType } from './image-validator.util';
import { assertMediaContainer, type MediaKind } from './media-validator.util';
import { isValidMediaSignature, signMediaKey } from './media-signature.util';

// 单张图片体积上限：2MB
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// 图片 key 白名单
export const IMAGE_KEY_PATTERN =
  /^image\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.(png|jpg|webp)$/;
// 媒体 key 白名单
export const MEDIA_KEY_PATTERN =
  /^(video|audio)\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.(mp4|webm|m4a|mp3)$/;
// 识别容器时读取的文件头长度
const MEDIA_HEAD_BYTES = 64 * 1024;
// 临时文件最长保留时间：24 小时
const TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// 图片类型到标准 MIME 的映射
const MIME_BY_TYPE: Record<ImageType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
// 图片类型到文件扩展名的映射（JPEG 统一用 .jpg）
const EXT_BY_TYPE: Record<ImageType, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
};
// 媒体扩展名到 MIME 的映射
const MEDIA_MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
};

// 图片上传入参
export interface UploadImageInput {
  buffer: Buffer; // 文件内容
  mimeType: string; // 客户端声明的 Content-Type
}

// 图片上传结果
export interface UploadData {
  key: string; // 相对 key
  url: string; // 公开访问 URL
}

// 媒体保存入参
export interface SaveMediaInput {
  tempPath: string; // multer 写入的临时文件绝对路径
  kind: MediaKind; // 视频或音频
}

// 媒体上传结果
export interface UploadMediaData {
  key: string; // 相对 key
  url: string; // 短期签名播放 URL
  mimeType: string; // 标准 MIME
  size: number; // 文件字节数
}

// 本地存储服务：图片公开落盘、媒体受保护落盘与签名访问
@Injectable()
export class StorageService implements OnModuleInit {
  // 日志记录器：记录目录初始化与临时文件清理异常
  private readonly logger = new Logger(StorageService.name);

  // 构造函数：注入配置服务
  constructor(private readonly config: ConfigService) {}

  // 模块初始化：创建目录并清理过期临时文件
  async onModuleInit(): Promise<void> {
    await Promise.all([
      mkdir(this.publicRoot(), { recursive: true }),
      mkdir(this.protectedRoot(), { recursive: true }),
      mkdir(this.tmpRoot(), { recursive: true }),
    ]);
    await this.cleanupTmp();
  }

  // 上传图片：校验 → 重编码 → 写 public → 返回公开 URL
  async uploadImage(file: UploadImageInput): Promise<UploadData> {
    // 应用层兜底体积校验
    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new BizException(ErrorCode.PARAM_INVALID, '图片不能超过 2MB', 422);
    }

    // 以文件头识别真实类型
    const type = detectImageType(file.buffer);
    // 声明的 MIME 必须与真实类型一致
    if (file.mimeType !== MIME_BY_TYPE[type]) {
      throw new BizException(ErrorCode.PARAM_INVALID, '图片内容与类型不符', 422);
    }

    // 重编码：rotate() 按 EXIF 摆正，输出不携带元数据
    const pipeline = sharp(file.buffer).rotate();
    // sharp 解码失败说明文件已损坏或伪造成合法文件头
    let cleaned: Buffer;
    try {
      cleaned = await (
        type === 'png'
          ? pipeline.png()
          : type === 'jpeg'
            ? pipeline.jpeg()
            : pipeline.webp()
      ).toBuffer();
    } catch {
      throw new BizException(ErrorCode.PARAM_INVALID, '图片无法解析', 422);
    }

    // 生成图片 key
    const key = `image/${this.datePath()}/${randomUUID()}.${EXT_BY_TYPE[type]}`;
    // 目标绝对路径
    const target = join(this.publicRoot(), key);
    await mkdir(dirname(target), { recursive: true });

    // 同目录临时文件 + rename，避免读取到半截文件
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, cleaned);
    await rename(temp, target);

    return { key, url: this.imageUrl(key) };
  }

  // 保存音视频：校验体积与容器 → 移动到 protected → 返回签名 URL
  async saveMedia(input: SaveMediaInput): Promise<UploadMediaData> {
    try {
      // 读取临时文件大小
      const info = await stat(input.tempPath);
      // 按类型选择上限
      const max =
        input.kind === 'video'
          ? this.upload().videoMaxBytes
          : this.upload().audioMaxBytes;

      if (info.size > max) {
        const label = input.kind === 'video' ? '视频' : '音频';
        const limitMb = Math.floor(max / (1024 * 1024));
        throw new BizException(
          ErrorCode.PARAM_INVALID,
          `${label}不能超过 ${limitMb}MB`,
          422,
        );
      }

      // 读取文件头识别真实容器
      const head = await this.readHead(input.tempPath);
      const { container, mimeType } = assertMediaContainer(head, input.kind);

      // 生成媒体 key
      const key = `${input.kind}/${this.datePath()}/${randomUUID()}.${container}`;
      // 目标绝对路径
      const target = join(this.protectedRoot(), key);
      await mkdir(dirname(target), { recursive: true });
      // 临时文件移动到受保护目录
      await rename(input.tempPath, target);

      return { key, url: this.mediaUrl(key), mimeType, size: info.size };
    } catch (error) {
      // 任何失败都清理临时文件
      await rm(input.tempPath, { force: true });
      throw error;
    }
  }

  // 解析存储值：图片给公开 URL，媒体给签名 URL，历史 http(s) 原样，未知返回 null
  async resolveUrl(value: string | null | undefined): Promise<string | null> {
    if (value === null || value === undefined || value === '') return null;
    // 历史数据兼容：已是对外地址则不再处理
    if (/^https?:\/\//i.test(value)) return value;
    // 图片 key：公开静态地址
    if (IMAGE_KEY_PATTERN.test(value)) return this.imageUrl(value);
    // 媒体 key：短期签名地址
    if (MEDIA_KEY_PATTERN.test(value)) return this.mediaUrl(value);
    // 旧 MinIO key 与非法值不再透传
    return null;
  }

  // 富文本图片解析：把 data-key 重写为图片公开地址，保留 data-key
  async resolveRichHtml(html: string): Promise<string> {
    if (!html) return html;
    // 收集待重写的 key
    const keys = collectImageKeys(html);
    if (keys.length === 0) return html;

    // 可解析的 key -> URL
    const urls = new Map<string, string>();
    for (const key of keys) {
      const url = await this.resolveUrl(key);
      if (url) urls.set(key, url);
    }
    // 全部无法解析时原样返回
    if (urls.size === 0) return html;
    return applyImageUrls(html, urls);
  }

  // 生成媒体播放地址：签名覆盖 key 与过期时间
  mediaUrl(key: string): string {
    const exp = Math.floor(Date.now() / 1000) + this.upload().mediaUrlTtlSec;
    const sig = signMediaKey(this.upload().signingSecret, key, exp);
    const query = new URLSearchParams({ key, exp: String(exp), sig });
    return `${this.upload().publicBaseUrl}/api/v1/files/media?${query.toString()}`;
  }

  // 校验媒体签名：key 必须符合白名单
  verifyMediaSignature(key: string, exp: number, sig: string): boolean {
    if (!MEDIA_KEY_PATTERN.test(key)) return false;
    return isValidMediaSignature(
      this.upload().signingSecret,
      key,
      exp,
      sig,
    );
  }

  // 媒体 key 映射到 protected 下的绝对路径，并阻断路径穿越
  mediaFilePath(key: string): string {
    if (!MEDIA_KEY_PATTERN.test(key)) {
      throw new BizException(ErrorCode.FORBIDDEN, '链接无效或已过期', 403);
    }
    const root = this.protectedRoot();
    const target = resolve(root, key);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new BizException(ErrorCode.FORBIDDEN, '链接无效或已过期', 403);
    }
    return target;
  }

  // 媒体 MIME：按扩展名返回
  mediaMimeForKey(key: string): string {
    const ext = extname(key).slice(1).toLowerCase();
    return MEDIA_MIME_BY_EXT[ext] ?? 'application/octet-stream';
  }

  // 媒体文件是否存在
  async mediaExists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.mediaFilePath(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  // Nginx 内部重定向前缀
  xAccelPrefix(): string {
    return this.upload().xAccelPrefix;
  }

  // 读取上传配置段
  private upload(): AppConfig['upload'] {
    return this.config.get<AppConfig['upload']>('upload')!;
  }

  // public 根目录
  private publicRoot(): string {
    return join(this.upload().dir, 'public');
  }

  // protected 根目录
  private protectedRoot(): string {
    return join(this.upload().dir, 'protected');
  }

  // tmp 根目录
  private tmpRoot(): string {
    return join(this.upload().dir, 'tmp');
  }

  // UTC 日期路径：YYYY/MM/DD
  private datePath(): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return `${yyyy}/${mm}/${dd}`;
  }

  // 图片公开 URL
  private imageUrl(key: string): string {
    return `${this.upload().publicBaseUrl}/uploadFiles/${key}`;
  }

  // 读取文件头，避免把大文件整体读入内存
  private async readHead(path: string): Promise<Buffer> {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(MEDIA_HEAD_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  // 清理超过 24 小时的 tmp 文件
  private async cleanupTmp(): Promise<void> {
    const now = Date.now();
    const entries = await readdir(this.tmpRoot(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(this.tmpRoot(), entry.name);
      try {
        const info = await stat(path);
        if (now - info.mtimeMs > TMP_MAX_AGE_MS) {
          await rm(path, { force: true });
        }
      } catch (error) {
        this.logger.warn(`清理临时文件失败：${(error as Error).message}`);
      }
    }
  }
}
