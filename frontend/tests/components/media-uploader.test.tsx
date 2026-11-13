import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp, Form } from 'antd';
import { http, HttpResponse } from 'msw';
import { MediaUploader } from '@/components/common/MediaUploader';
import { probeVideoDecodable } from '@/lib/media-probe';
import { server } from '../msw/server';

// 视频探测：默认判定可解码，单个用例可覆盖
vi.mock('@/lib/media-probe', () => ({
  probeVideoDecodable: vi.fn(),
}));

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-media' };
}

describe('MediaUploader', () => {
  beforeEach(() => {
    vi.mocked(probeVideoDecodable).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.mocked(probeVideoDecodable).mockReset();
  });

  it('选择合法视频后上传并回传 key', async () => {
    // 记录接口是否被调用
    let called = false;
    server.use(
      http.post(/\/api\/v1\/admin\/files\/video$/, () => {
        called = true;
        return HttpResponse.json(
          envelope({
            key: 'video/2026/11/12/x.mp4',
            url: 'http://media.test/v.mp4',
            mimeType: 'video/mp4',
            size: 4,
          }),
          { status: 201 },
        );
      }),
    );

    const onChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <MediaUploader kind="video" onChange={onChange} />
      </AntdApp>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['test'], 'a.mp4', { type: 'video/mp4' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('video/2026/11/12/x.mp4'));
    expect(called).toBe(true);
    expect(container.querySelector('video')).not.toBeNull();
  });

  it('表单内原生文件选择框不可见（AntD 表单重置会覆盖 hidden 属性）', () => {
    const { container } = render(
      <AntdApp>
        <Form>
          <Form.Item name="content">
            <MediaUploader kind="video" />
          </Form.Item>
        </Form>
      </AntdApp>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    expect(getComputedStyle(input).display).toBe('none');
  });

  it('不支持的类型不发起上传', async () => {
    // 记录接口是否被调用
    let called = false;
    server.use(
      http.post(/\/api\/v1\/admin\/files\/video$/, () => {
        called = true;
        return HttpResponse.json(envelope({}));
      }),
    );

    const onChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <MediaUploader kind="video" onChange={onChange} />
      </AntdApp>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['test'], 'a.mkv', { type: 'video/x-matroska' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/视频仅支持 MP4\/WebM/)).toBeInTheDocument();
    expect(called).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('浏览器无法解码画面的视频不发起上传', async () => {
    // 探测结果：容器合法但画面无法解码（如 MPEG-4 Visual）
    vi.mocked(probeVideoDecodable).mockResolvedValue(false);
    // 记录接口是否被调用
    let called = false;
    server.use(
      http.post(/\/api\/v1\/admin\/files\/video$/, () => {
        called = true;
        return HttpResponse.json(envelope({}));
      }),
    );

    const onChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <MediaUploader kind="video" onChange={onChange} />
      </AntdApp>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['test'], 'b.mp4', { type: 'video/mp4' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/该视频没有可播放的画面/)).toBeInTheDocument();
    expect(called).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('音频上传不做视频解码探测', async () => {
    const onChange = vi.fn();
    server.use(
      http.post(/\/api\/v1\/admin\/files\/audio$/, () =>
        HttpResponse.json(
          envelope({
            key: 'audio/2026/11/12/x.mp3',
            url: 'http://media.test/a.mp3',
            mimeType: 'audio/mpeg',
            size: 4,
          }),
          { status: 201 },
        ),
      ),
    );
    const { container } = render(
      <AntdApp>
        <MediaUploader kind="audio" onChange={onChange} />
      </AntdApp>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['test'], 'a.mp3', { type: 'audio/mpeg' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('audio/2026/11/12/x.mp3'));
    expect(probeVideoDecodable).not.toHaveBeenCalled();
  });
});
