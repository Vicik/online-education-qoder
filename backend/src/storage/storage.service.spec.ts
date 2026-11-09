import { ConfigService } from '@nestjs/config';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

// sharp 管道替身：rotate/png/jpeg/webp 链式返回自身，最终 toBuffer 由测试控制
const mockPipeline: Record<string, jest.Mock> = {};
// 模拟 sharp 函数本身，记录被调用参数
const mockSharp = jest.fn();

// 用 jest.mock 隔离 sharp 原生依赖，单测不真正解码图片
jest.mock('sharp', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockSharp(...args),
}));

// 隔离签名 URL 生成，避免单测依赖 AWS 签名实现
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

// PNG 文件头
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// JPEG 文件头
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

// 生成登录用的 ConfigService 替身
function fakeConfig(): ConfigService {
  return {
    get: jest.fn(() => ({
      endpoint: 'http://minio.local',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucket: 'zhixu',
      publicUrl: 'http://minio.local/zhixu',
    })),
  } as unknown as ConfigService;
}

describe('StorageService', () => {
  // fake S3 客户端
  let s3: { send: jest.Mock };
  // 被测服务
  let service: StorageService;
  // 签名 URL 的 mock 引用
  const getSignedUrlMock = getSignedUrl as unknown as jest.Mock;

  beforeEach(() => {
    // 重建链式管道替身
    mockPipeline.rotate = jest.fn(() => mockPipeline);
    mockPipeline.png = jest.fn(() => mockPipeline);
    mockPipeline.jpeg = jest.fn(() => mockPipeline);
    mockPipeline.webp = jest.fn(() => mockPipeline);
    mockPipeline.toBuffer = jest.fn();
    mockSharp.mockReturnValue(mockPipeline);
    s3 = { send: jest.fn().mockResolvedValue({}) };
    service = new StorageService(s3 as never, fakeConfig());
  });

  it('超过 2MB 拒绝', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    await expect(
      service.uploadImage({
        buffer: big,
        mimeType: 'image/png',
        originalName: 'a.png',
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('重编码后 putObject 到私有桶，返回 key 与签名 url', async () => {
    const reEncoded = Buffer.from('re-encoded');
    mockPipeline.toBuffer.mockResolvedValue(reEncoded);
    getSignedUrlMock.mockResolvedValue(
      'https://minio.local/zhixu/2026/11/uuid.png?X-Amz-Signature=abc',
    );

    const r = await service.uploadImage({
      buffer: PNG,
      mimeType: 'image/png',
      originalName: 'a.png',
    });

    expect(r.key).toMatch(/^zhixu\/\d{4}\/\d{2}\/[\w-]+\.png$/);
    expect(r.url).toContain('X-Amz-Signature');
    expect(mockSharp).toHaveBeenCalledWith(PNG);
    expect(mockPipeline.rotate).toHaveBeenCalled();
    expect(mockPipeline.png).toHaveBeenCalled();
    expect(s3.send).toHaveBeenCalledTimes(1);
    expect(s3.send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'zhixu',
      Key: r.key,
      Body: reEncoded,
      ContentType: 'image/png',
    });
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      s3,
      expect.any(GetObjectCommand),
      { expiresIn: 900 },
    );
  });

  it('JPEG 重编码后 key 使用 .jpg 扩展名', async () => {
    mockPipeline.toBuffer.mockResolvedValue(Buffer.from('re-encoded'));
    getSignedUrlMock.mockResolvedValue('https://minio.local/signed');

    const r = await service.uploadImage({
      buffer: JPEG,
      mimeType: 'image/jpeg',
      originalName: 'a.jpg',
    });

    expect(r.key).toMatch(/\.jpg$/);
    expect(mockPipeline.jpeg).toHaveBeenCalled();
  });

  it('MIME 与 magic bytes 不符拒绝', async () => {
    await expect(
      service.uploadImage({
        buffer: JPEG,
        mimeType: 'image/png',
        originalName: 'a.png',
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });
    expect(mockSharp).not.toHaveBeenCalled();
    expect(s3.send).not.toHaveBeenCalled();
  });

  it('presignGet 默认 15 分钟，可覆盖过期时间', async () => {
    getSignedUrlMock.mockResolvedValue('https://minio.local/signed');

    await expect(service.presignGet('zhixu/a.png')).resolves.toBe(
      'https://minio.local/signed',
    );
    expect(getSignedUrlMock).toHaveBeenLastCalledWith(
      s3,
      expect.any(GetObjectCommand),
      { expiresIn: 900 },
    );

    await service.presignGet('zhixu/a.png', 60);
    expect(getSignedUrlMock).toHaveBeenLastCalledWith(
      s3,
      expect.any(GetObjectCommand),
      { expiresIn: 60 },
    );
  });
});
