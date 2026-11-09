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
function fakeConfig(
  overrides: Partial<{ presignTtlSec: number }> = {},
): ConfigService {
  return {
    get: jest.fn(() => ({
      endpoint: 'http://minio.local',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucket: 'zhixu',
      publicUrl: 'http://minio.local/zhixu',
      presignTtlSec: 3600,
      ...overrides,
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
      { expiresIn: 3600 },
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

  it('presignGet 默认使用配置有效期，可覆盖过期时间', async () => {
    getSignedUrlMock.mockResolvedValue('https://minio.local/signed');

    await expect(service.presignGet('zhixu/a.png')).resolves.toBe(
      'https://minio.local/signed',
    );
    expect(getSignedUrlMock).toHaveBeenLastCalledWith(
      s3,
      expect.any(GetObjectCommand),
      { expiresIn: 3600 },
    );

    await service.presignGet('zhixu/a.png', 60);
    expect(getSignedUrlMock).toHaveBeenLastCalledWith(
      s3,
      expect.any(GetObjectCommand),
      { expiresIn: 60 },
    );
  });

  it('presignGet 有效期取自配置', async () => {
    getSignedUrlMock.mockResolvedValue('https://minio.local/signed');
    const custom = new StorageService(
      s3 as never,
      fakeConfig({ presignTtlSec: 1800 }),
    );

    await custom.presignGet('zhixu/a.png');

    expect(getSignedUrlMock).toHaveBeenLastCalledWith(
      s3,
      expect.any(GetObjectCommand),
      { expiresIn: 1800 },
    );
  });

  it('resolveUrl 对空值与非法值返回 null', async () => {
    await expect(service.resolveUrl(null)).resolves.toBeNull();
    await expect(service.resolveUrl(undefined)).resolves.toBeNull();
    await expect(service.resolveUrl('')).resolves.toBeNull();
    await expect(service.resolveUrl('javascript:alert(1)')).resolves.toBeNull();
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('resolveUrl 原样返回历史 http(s) 地址，不签名', async () => {
    await expect(service.resolveUrl('https://cdn.test/a.png')).resolves.toBe(
      'https://cdn.test/a.png',
    );
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('resolveUrl 对存储 key 生成签名地址', async () => {
    getSignedUrlMock.mockResolvedValue('https://minio.local/signed');

    await expect(service.resolveUrl('zhixu/2026/11/a.png')).resolves.toBe(
      'https://minio.local/signed',
    );
    const command = getSignedUrlMock.mock.calls[0][1] as GetObjectCommand;
    expect(command.input).toMatchObject({
      Bucket: 'zhixu',
      Key: 'zhixu/2026/11/a.png',
    });
  });

  it('signRichHtml 重写 data-key 图片为签名地址并保留 data-key', async () => {
    getSignedUrlMock.mockImplementation(
      (_s3: unknown, command: GetObjectCommand) =>
        Promise.resolve(`https://signed/${command.input.Key}`),
    );

    const out = await service.signRichHtml(
      '<p>正文</p>' +
        '<img data-key="zhixu/a.png" src="zhixu/a.png" alt="图" />' +
        '<img data-key="zhixu/a.png" src="zhixu/a.png" />' +
        '<img src="https://cdn.test/legacy.png" />',
    );

    expect(out).toContain('src="https://signed/zhixu/a.png"');
    expect(out).toContain('data-key="zhixu/a.png"');
    expect(out).toContain('src="https://cdn.test/legacy.png"');
    // 同一 key 只签名一次
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
  });

  it('signRichHtml 无存储 key 时不签名并原样返回', async () => {
    const html = '<p>没有图片</p><img src="https://cdn.test/a.png" />';

    await expect(service.signRichHtml(html)).resolves.toBe(html);
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it('signRichHtml 空串返回空串', async () => {
    await expect(service.signRichHtml('')).resolves.toBe('');
  });
});
