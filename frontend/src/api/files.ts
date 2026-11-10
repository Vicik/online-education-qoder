import { request } from './client';

// 上传返回：key 持久化，url 仅用于即时预览
export interface UploadResult {
  key: string;
  url: string;
}

// 图片上传：PNG/JPEG/WebP，单张 ≤2MB 由前端预检 + 后端复核
export function uploadImage(file: File): Promise<UploadResult> {
  // 上传走 multipart/form-data，交给浏览器生成 boundary
  const formData = new FormData();
  formData.append('file', file);
  return request<UploadResult>({ url: '/files/upload', method: 'POST', data: formData });
}
