// 元数据探测超时：本地文件解析通常在 1 秒内完成，超时视为不可用
const PROBE_TIMEOUT_MS = 10_000;

// 判断本地视频能否被浏览器解码出画面
// Chrome 对不受支持的视频编码（如 MPEG-4 Visual/mp4v）只播放音频且 videoWidth 为 0，
// 预览会呈现为音频样式，因此上传前先探测画面宽度
export function probeVideoDecodable(
  file: File,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  // 本地对象地址：仅用于探测，结束后释放
  const objectUrl = URL.createObjectURL(file);
  // 离屏探测元素：不插入文档
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.src = objectUrl;

  return new Promise<boolean>((resolve) => {
    // 是否已结束，避免事件与超时重复回调
    let settled = false;
    // 结束探测：清理监听、地址与解码资源
    const finish = (decodable: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
      resolve(decodable);
    };
    // 超时保护：迟迟拿不到元数据时按不可用处理
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    // 元数据就绪：画面宽度大于 0 才可能正常预览
    video.addEventListener('loadedmetadata', () => finish(video.videoWidth > 0));
    // 解码错误：直接判定不可用
    video.addEventListener('error', () => finish(false));
    video.load();
  });
}
