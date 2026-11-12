import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from './storage.service';

// sharp 管道替身：链式方法返回自身，toBuffer 由测试控制
const mockPipeline: Record<string, jest.Mock> = {};
// sharp 函数替身，记录输入参数
const mockSharp = jest.fn();

// 隔离 sharp 原生依赖，单测不真正解码图片
jest.mock('sharp', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockSharp(...args),
}));

// PNG 文件头
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// JPEG 文件头
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

// 构造 MP4 文件头
function mp4(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.alloc(8, 0x01),
  ]);
}

// 构造 M4A 文件头
function m4a(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypM4A '),
    Buffer.alloc(8, 0x01),
  ]);
}

// 构造 MP3 文件头：合法 ID3v2.4 标签（10 字节）+ 音频数据
function mp3(): Buffer {
  return Buffer.concat([
    Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000'),
    Buffer.alloc(32, 0x01),
  ]);
}

// ConfigService 替身：固定指向测试目录与上限
function fakeConfig(dir: string): ConfigService {
  return {
    get: jest.fn(() => ({
      dir,
      publicBaseUrl: 'http://cdn.test',
      signingSecret: 'test-secret',
      audioMaxBytes: 1024 * 1024,
      videoMaxBytes: 2 * 1024 * 1024,
      mediaUrlTtlSec: 3600,
      xAccelPrefix: '/_protected_media/',
    })),
  } as unknown as ConfigService;
}

describe('StorageService', () => {
  // 每个用例独立的临时上传根目录
  let dir: string;
  // 被测服务
  let service: StorageService;

  beforeEach(async () => {
    // 重建 sharp 管道替身
    mockPipeline.rotate = jest.fn(() => mockPipeline);
    mockPipeline.png = jest.fn(() => mockPipeline);
    mockPipeline.jpeg = jest.fn(() => mockPipeline);
    mockPipeline.webp = jest.fn(() => mockPipeline);
    mockPipeline.toBuffer = jest.fn();
    mockSharp.mockReturnValue(mockPipeline);

    dir = await mkdtemp(join(tmpdir(), 'zhixu-storage-'));
    service = new StorageService(fakeConfig(dir));
    await service.onModuleInit();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // 在 tmp 目录写一个待处理文件
  async function writeTemp(name: string, content: Buffer): Promise<string> {
    const path = join(dir, 'tmp', name);
    await writeFile(path, content);
    return path;
  }

  it('超过 2MB 的图片拒绝', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    await expect(
      service.uploadImage({ buffer: big, mimeType: 'image/png' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
  });

  it('内容与声明 MIME 不符拒绝', async () => {
    await expect(
      service.uploadImage({ buffer: PNG, mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('PNG 重编码后写入 public/image，返回公开 URL', async () => {
    mockPipeline.toBuffer.mockResolvedValue(Buffer.from('re-encoded'));

    const result = await service.uploadImage({
      buffer: PNG,
      mimeType: 'image/png',
    });

    expect(result.key).toMatch(
      /^image\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.png$/,
    );
    expect(result.url).toBe(`http://cdn.test/uploadFiles/${result.key}`);
    const saved = await readFile(join(dir, 'public', ...result.key.split('/')));
    expect(saved.toString()).toBe('re-encoded');
    expect(mockPipeline.rotate).toHaveBeenCalled();
    expect(mockPipeline.png).toHaveBeenCalled();
  });

  it('JPEG 重编码后扩展名为 .jpg', async () => {
    mockPipeline.toBuffer.mockResolvedValue(Buffer.from('re-encoded'));
    const result = await service.uploadImage({
      buffer: JPEG,
      mimeType: 'image/jpeg',
    });
    expect(result.key).toMatch(/\.jpg$/);
    expect(mockPipeline.jpeg).toHaveBeenCalled();
  });

  it('sharp 无法解码时按 422 拒绝', async () => {
    mockPipeline.toBuffer.mockRejectedValue(new Error('bad image'));
    await expect(
      service.uploadImage({ buffer: PNG, mimeType: 'image/png' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
  });

  it('resolveUrl：图片公开、媒体签名、http 原样、旧 key 返回 null', async () => {
    const imageKey = 'image/2026/11/12/00000000-0000-0000-0000-000000000001.png';
    const mediaKey = 'video/2026/11/12/00000000-0000-0000-0000-000000000002.mp4';

    await expect(service.resolveUrl(imageKey)).resolves.toBe(
      `http://cdn.test/uploadFiles/${imageKey}`,
    );
    const mediaUrl = await service.resolveUrl(mediaKey);
    expect(mediaUrl).toContain('http://cdn.test/api/v1/files/media?');
    expect(mediaUrl).toContain('sig=');
    await expect(service.resolveUrl('https://cdn.test/legacy.png')).resolves.toBe(
      'https://cdn.test/legacy.png',
    );
    await expect(service.resolveUrl('zhixu/2026/11/a.png')).resolves.toBeNull();
    await expect(service.resolveUrl('videos/a.mp4')).resolves.toBeNull();
    await expect(service.resolveUrl('')).resolves.toBeNull();
  });

  it('resolveRichHtml 把 data-key 重写为公开 URL，历史 http 保持不变', async () => {
    const key = 'image/2026/11/12/00000000-0000-0000-0000-000000000003.webp';
    const html =
      `<p>正文</p><img data-key="${key}" src="${key}" alt="图" />` +
      '<img src="https://cdn.test/legacy.png" />';

    const output = await service.resolveRichHtml(html);

    expect(output).toContain(`src="http://cdn.test/uploadFiles/${key}"`);
    expect(output).toContain(`data-key="${key}"`);
    expect(output).toContain('src="https://cdn.test/legacy.png"');
  });

  it('resolveRichHtml 对旧 key 或无图片内容不报错', async () => {
    const legacy = '<img data-key="zhixu/a.png" src="zhixu/a.png" />';
    await expect(service.resolveRichHtml(legacy)).resolves.toBe(legacy);
    await expect(service.resolveRichHtml('')).resolves.toBe('');
  });

  it('媒体签名可验证，篡改与过期失败', () => {
    const key = 'video/2026/11/12/00000000-0000-0000-0000-000000000004.mp4';
    const url = new URL(service.mediaUrl(key));
    const exp = Number(url.searchParams.get('exp')!);
    const sig = url.searchParams.get('sig')!;

    expect(service.verifyMediaSignature(key, exp, sig)).toBe(true);
    expect(service.verifyMediaSignature(`${key}x`, exp, sig)).toBe(false);
    expect(
      service.verifyMediaSignature(key, Math.floor(Date.now() / 1000) - 1, sig),
    ).toBe(false);
    expect(service.verifyMediaSignature('bad/key.mp4', exp, sig)).toBe(false);
  });

  it('saveMedia 校验后移动到 protected，返回 key/签名 URL/MIME/size', async () => {
    const content = mp4();
    const temp = await writeTemp('video.part', content);

    const result = await service.saveMedia({ tempPath: temp, kind: 'video' });

    expect(result.key).toMatch(
      /^video\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.mp4$/,
    );
    expect(result.mimeType).toBe('video/mp4');
    expect(result.size).toBe(content.length);
    expect(result.url).toContain('/api/v1/files/media?');
    await expect(stat(temp)).rejects.toThrow();
    const saved = await readFile(join(dir, 'protected', ...result.key.split('/')));
    expect(saved.equals(content)).toBe(true);
    await expect(service.mediaExists(result.key)).resolves.toBe(true);
  });

  it('saveMedia 接受 MP3 音频，写入 protected/audio', async () => {
    const content = mp3();
    const temp = await writeTemp('audio-mp3.part', content);

    const result = await service.saveMedia({ tempPath: temp, kind: 'audio' });

    expect(result.key).toMatch(
      /^audio\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.mp3$/,
    );
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.size).toBe(content.length);
    const saved = await readFile(join(dir, 'protected', ...result.key.split('/')));
    expect(saved.equals(content)).toBe(true);
  });

  it('saveMedia 音频超过上限时清理临时文件', async () => {
    const content = Buffer.concat([m4a(), Buffer.alloc(1024 * 1024, 0x01)]);
    const temp = await writeTemp('audio.part', content);

    await expect(
      service.saveMedia({ tempPath: temp, kind: 'audio' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    await expect(stat(temp)).rejects.toThrow();
  });

  it('saveMedia 容器与接口不符时清理临时文件', async () => {
    const temp = await writeTemp('mismatch.part', m4a());
    await expect(
      service.saveMedia({ tempPath: temp, kind: 'video' }),
    ).rejects.toMatchObject({ bizCode: 1001 });
    await expect(stat(temp)).rejects.toThrow();
  });

  it('媒体路径拒绝穿越与非法 key', () => {
    expect(() => service.mediaFilePath('video/../../x.mp4')).toThrow(
      expect.objectContaining({ bizCode: 2002, status: 403 }),
    );
    expect(() => service.mediaFilePath('image/2026/11/12/a.png')).toThrow(
      expect.objectContaining({ bizCode: 2002 }),
    );
  });

  it('媒体 MIME 按扩展名返回', () => {
    expect(service.mediaMimeForKey('video/a.mp4')).toBe('video/mp4');
    expect(service.mediaMimeForKey('audio/a.mp3')).toBe('audio/mpeg');
    expect(service.mediaMimeForKey('audio/a.m4a')).toBe('audio/mp4');
  });

  it('启动时清理超过 24 小时的 tmp 文件', async () => {
    const stale = await writeTemp('stale.part', Buffer.from('x'));
    const fresh = await writeTemp('fresh.part', Buffer.from('y'));
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(stale, old, old);

    await service.onModuleInit();

    await expect(stat(stale)).rejects.toThrow();
    await expect(stat(fresh)).resolves.toBeTruthy();
  });

  it('xAccelPrefix 透传配置', () => {
    expect(service.xAccelPrefix()).toBe('/_protected_media/');
  });
});
