import type { MediaKind } from '@/lib/validators';
import { request } from './client';

// 图片上传返回：key 持久化，url 立即用于展示
export interface UploadResult {
  key: string;
  url: string;
}

// 媒体上传返回：key 持久化，url 为短期签名播放地址
export interface MediaUploadResult {
  key: string;
  url: string;
  mimeType: string;
  size: number;
}

// 媒体上传可选参数
export interface UploadMediaOptions {
  onProgress?: (percent: number) => void; // 上传进度回调
  signal?: AbortSignal; // 取消信号
}

// 图片上传：PNG/JPEG/WebP，单张 ≤2MB 由前端预检 + 后端复核
export function uploadImage(file: File): Promise<UploadResult> {
  // 上传走 multipart/form-data，交给浏览器生成 boundary
  const formData = new FormData();
  formData.append('file', file);
  return request<UploadResult>({ url: '/files/upload', method: 'POST', data: formData });
}

// 音视频上传：仅管理员，走 /admin/files/{kind}
export function uploadMedia(
  file: File,
  kind: MediaKind,
  options: UploadMediaOptions = {},
): Promise<MediaUploadResult> {
  // 上传走 multipart/form-data，交给浏览器生成 boundary
  const formData = new FormData();
  formData.append('file', file);
  return request<MediaUploadResult>({
    url: `/admin/files/${kind}`,
    method: 'POST',
    data: formData,
    signal: options.signal,
    onUploadProgress: (event) => {
      // 无总长度或未提供回调时跳过
      if (!options.onProgress || !event.total) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      options.onProgress(Math.min(100, Math.max(0, percent)));
    },
  });
}
