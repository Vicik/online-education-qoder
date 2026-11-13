import { probeVideoDecodable } from '@/lib/media-probe';

// 真实创建元素的原始实现
const createElement = document.createElement.bind(document);

// 构造可控制元数据结果的视频元素替身
function stubVideoElement(width: number) {
  // jsdom 真实 video 元素：保留事件与属性能力
  const video = createElement('video') as HTMLVideoElement;
  // 画面宽度：0 表示无可用视频画面（编码不受支持或仅有音频轨道）
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: width });
  // 加载即触发元数据事件
  video.load = () => {
    queueMicrotask(() => video.dispatchEvent(new Event('loadedmetadata')));
  };
  return video;
}

describe('probeVideoDecodable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('元数据加载后画面宽度大于 0 视为可解码', async () => {
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'video' ? stubVideoElement(1280) : createElement(tag),
    );
    // 文件内容不参与探测，只用于生成对象地址
    const file = new File(['x'], 'ok.mp4', { type: 'video/mp4' });

    await expect(probeVideoDecodable(file)).resolves.toBe(true);
  });

  it('画面宽度为 0 视为不可解码', async () => {
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'video' ? stubVideoElement(0) : createElement(tag),
    );
    const file = new File(['x'], 'mp4v.mp4', { type: 'video/mp4' });

    await expect(probeVideoDecodable(file)).resolves.toBe(false);
  });

  it('解码错误视为不可解码', async () => {
    const video = stubVideoElement(1280);
    // 加载时直接触发错误事件
    video.load = () => {
      queueMicrotask(() => video.dispatchEvent(new Event('error')));
    };
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'video' ? video : createElement(tag),
    );
    const file = new File(['x'], 'broken.mp4', { type: 'video/mp4' });

    await expect(probeVideoDecodable(file)).resolves.toBe(false);
  });

  it('超时未加载元数据视为不可解码并释放对象地址', async () => {
    vi.useFakeTimers();
    // 视频占位：不触发任何事件，等待超时
    const video = stubVideoElement(1280);
    video.load = () => {};
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'video' ? video : createElement(tag),
    );
    // 记录对象地址释放次数
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const file = new File(['x'], 'slow.mp4', { type: 'video/mp4' });

    const pending = probeVideoDecodable(file, 1000);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toBe(false);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
