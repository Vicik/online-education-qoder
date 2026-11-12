import { delay, http, HttpResponse } from 'msw';
import { afterEach } from 'vitest';
import { uploadImage, uploadMedia } from '@/api/files';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-files' };
}

// 构造视频文件
function videoFile(): File {
  return new File(['test'], 'a.mp4', { type: 'video/mp4' });
}

// jsdom 的 FormData 经 msw 拦截后会被序列化成 "[object FormData]"，
// 无法读取 multipart 头；改为在表单组装处断言字段名与文件。
function spyFormAppend() {
  const original = FormData.prototype.append;
  const calls: unknown[][] = [];
  FormData.prototype.append = function (this: FormData, ...args: unknown[]) {
    calls.push(args);
    return (original as (...values: unknown[]) => void).apply(this, args);
  } as typeof FormData.prototype.append;
  return { calls, restore: () => (FormData.prototype.append = original) };
}

describe('files api', () => {
  const spies: Array<() => void> = [];

  afterEach(() => {
    // 每个用例结束后恢复原型，避免影响其他测试
    spies.splice(0).forEach((restore) => restore());
  });

  it('上传视频到管理端接口并返回 key/url/mimeType/size', async () => {
    // 断言表单字段名与文件
    const form = spyFormAppend();
    spies.push(form.restore);
    // 记录命中的路径
    let path = '';
    server.use(
      http.post(/\/api\/v1\/admin\/files\/video$/, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json(
          envelope({
            key: 'video/2026/11/12/00000000-0000-0000-0000-000000000001.mp4',
            url: 'http://localhost:3000/api/v1/files/media?key=x&exp=1&sig=y',
            mimeType: 'video/mp4',
            size: 4,
          }),
          { status: 201 },
        );
      }),
    );

    const result = await uploadMedia(videoFile(), 'video');

    expect(path).toBe('/api/v1/admin/files/video');
    expect(form.calls).toHaveLength(1);
    expect(form.calls[0][0]).toBe('file');
    expect(form.calls[0][1]).toBeInstanceOf(File);
    expect(result.key).toContain('video/');
    expect(result.mimeType).toBe('video/mp4');
    expect(result.size).toBe(4);
  });

  it('音频上传走 audio 接口', async () => {
    // 记录命中的路径
    let path = '';
    server.use(
      http.post(/\/api\/v1\/admin\/files\/audio$/, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json(
          envelope({
            key: 'audio/2026/11/12/00000000-0000-0000-0000-000000000002.mp3',
            url: 'http://localhost:3000/api/v1/files/media?key=y&exp=1&sig=z',
            mimeType: 'audio/mpeg',
            size: 4,
          }),
          { status: 201 },
        );
      }),
    );

    const result = await uploadMedia(
      new File(['test'], 'a.mp3', { type: 'audio/mpeg' }),
      'audio',
    );

    expect(path).toBe('/api/v1/admin/files/audio');
    expect(result.mimeType).toBe('audio/mpeg');
  });

  it('图片上传支持取消信号', async () => {
    server.use(
      http.post(/\/api\/v1\/files\/upload$/, async () => {
        // 延迟响应，给取消留出时间
        await delay(200);
        return HttpResponse.json(
          envelope({ key: 'image/2026/11/12/x.png', url: 'http://x.test/x.png' }),
          { status: 201 },
        );
      }),
    );
    // 取消信号：在请求发出后立即取消
    const controller = new AbortController();
    const pending = uploadImage(
      new File(['test'], 'a.png', { type: 'image/png' }),
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
