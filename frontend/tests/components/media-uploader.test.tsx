import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { http, HttpResponse } from 'msw';
import { MediaUploader } from '@/components/common/MediaUploader';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-media' };
}

describe('MediaUploader', () => {
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
});
