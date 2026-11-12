import { App as AntdApp, Button, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { uploadImage } from '@/api/files';
import { isAllowedImage } from '@/lib/validators';
import { resolveImageUrl } from '@/lib/image-url';

// 表单中的图片值：key 用于提交，url 仅用于预览
export interface ImageValue {
  key: string;
  url?: string | null;
}

// 封面缩略图边长（px）
const TILE_SIZE = 96;

// 图片上传：缩略图即上传入口，仅保留一张，点击可更换；表单只提交 key
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
      // 上传成功：key 持久化，url 立即用于预览（重复上传即替换当前图片）
      const result = await uploadImage(file);
      onChange?.({ key: result.key, url: result.url });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片上传失败');
    }
    return false;
  };

  return (
    <div>
      <Upload
        accept="image/png,image/jpeg,image/webp"
        showUploadList={false}
        beforeUpload={beforeUpload}
        disabled={disabled}
      >
        <button
          type="button"
          disabled={disabled}
          aria-label={previewUrl ? '更换封面图片' : '上传封面图片'}
          style={{
            width: TILE_SIZE,
            height: TILE_SIZE,
            padding: 0,
            border: previewUrl ? 'none' : '1px dashed #d9d9d9',
            borderRadius: 8,
            background: previewUrl ? 'transparent' : '#fafafa',
            cursor: disabled ? 'not-allowed' : 'pointer',
            overflow: 'hidden',
            display: 'block',
            color: '#8c8c8c',
            fontSize: 13,
          }}
        >
          {previewUrl ? (
            <span style={{ position: 'relative', display: 'block', width: '100%', height: '100%' }}>
              <img
                src={previewUrl}
                alt="封面预览"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  lineHeight: '20px',
                  textAlign: 'center',
                  color: '#fff',
                  background: 'rgba(0, 0, 0, 0.5)',
                }}
              >
                更换
              </span>
            </span>
          ) : (
            '上传图片'
          )}
        </button>
      </Upload>
      {value?.key && (
        <div style={{ marginTop: 4 }}>
          <Button type="link" size="small" danger disabled={disabled} onClick={() => onChange?.(null)}>
            清除
          </Button>
        </div>
      )}
    </div>
  );
}
