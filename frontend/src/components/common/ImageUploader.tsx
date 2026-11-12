import { App as AntdApp, Avatar, Button, Space, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { uploadImage } from '@/api/files';
import { isAllowedImage } from '@/lib/validators';
import { resolveImageUrl } from '@/lib/image-url';

// 表单中的图片值：key 用于提交，url 仅用于预览
export interface ImageValue {
  key: string;
  url?: string | null;
}

// 图片上传：预检类型/大小；表单只提交 key
export function ImageUploader({
  value,
  onChange,
  disabled,
}: {
  value?: ImageValue | null;
  onChange?: (value: ImageValue | null) => void;
  disabled?: boolean;
}) {
  const { message } = AntdApp.useApp();
  // 预览地址：优先用上传返回的公开 URL，其次尝试 key 本身是否为 http(s)
  const previewUrl = value?.url ?? resolveImageUrl(value?.key, null);

  // 上传前预检并立刻上传；返回 false 阻止 AntD 默认上传
  const beforeUpload: UploadProps['beforeUpload'] = async (file) => {
    if (!isAllowedImage(file)) {
      message.error('图片仅支持 PNG/JPEG/WebP，且不超过 2MB');
      return Upload.LIST_IGNORE;
    }
    try {
      // 上传成功：key 持久化，url 立即用于预览
      const result = await uploadImage(file);
      onChange?.({ key: result.key, url: result.url });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片上传失败');
    }
    return false;
  };

  return (
    <Space align="start">
      <Avatar shape="square" size={96} src={previewUrl} />
      <Space direction="vertical">
        <Upload
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          beforeUpload={beforeUpload}
          disabled={disabled}
        >
          <Button disabled={disabled}>{value?.key ? '更换图片' : '上传图片'}</Button>
        </Upload>
        {value?.key && (
          <Button type="link" danger disabled={disabled} onClick={() => onChange?.(null)}>
            清除
          </Button>
        )}
      </Space>
    </Space>
  );
}
