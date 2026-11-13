import { App as AntdApp, Button, Progress, Space, Typography } from 'antd';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { uploadMedia } from '@/api/files';
import { probeVideoDecodable } from '@/lib/media-probe';
import { isAllowedMedia, type MediaKind } from '@/lib/validators';

// 媒体上传：预检、进度、取消与即时预览；表单只保存 key
export function MediaUploader({
  kind,
  value,
  onChange,
  disabled,
}: {
  kind: MediaKind; // 视频或音频
  value?: string | null; // 已保存的 key
  onChange?: (key: string | null) => void; // key 变化回调
  disabled?: boolean; // 只读态
}) {
  // AntD 消息
  const { message } = AntdApp.useApp();
  // 隐藏的文件选择器
  const inputRef = useRef<HTMLInputElement>(null);
  // 当前上传的取消控制器
  const abortRef = useRef<AbortController | null>(null);
  // 是否正在上传
  const [uploading, setUploading] = useState(false);
  // 上传进度百分比
  const [percent, setPercent] = useState(0);
  // 本次上传的预览地址
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 本次选择的文件名
  const [fileName, setFileName] = useState<string | null>(null);
  // 文案：视频/音频
  const label = kind === 'video' ? '视频' : '音频';

  useEffect(() => {
    // 外部清空 key 时同步清空预览
    if (!value) {
      setPreviewUrl(null);
      setFileName(null);
    }
  }, [value]);

  // 选择文件：预检后上传，成功后回传 key
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!isAllowedMedia(file, kind)) {
      message.error(
        kind === 'video'
          ? '视频仅支持 MP4/WebM，且不超过 1GB'
          : '音频仅支持 MP3/M4A，且不超过 100MB',
      );
      return;
    }

    // 视频需浏览器能解码出画面，否则预览会退化为音频样式
    if (kind === 'video' && !(await probeVideoDecodable(file))) {
      message.error(
        '该视频没有可播放的画面，请使用 H.264/VP9/AV1 编码的 MP4/WebM',
      );
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setPercent(0);
    setFileName(file.name);
    try {
      const result = await uploadMedia(file, kind, {
        signal: controller.signal,
        onProgress: setPercent,
      });
      setPreviewUrl(result.url);
      onChange?.(result.key);
      message.success('上传成功');
    } catch (error) {
      // 用户主动取消不算失败
      if (controller.signal.aborted) {
        message.info('已取消上传');
        return;
      }
      message.error(error instanceof Error ? error.message : '上传失败');
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  }

  // 取消上传
  function cancelUpload() {
    abortRef.current?.abort();
  }

  // 清除已上传内容
  function clear() {
    setPreviewUrl(null);
    setFileName(null);
    onChange?.(null);
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {previewUrl ? (
        kind === 'video' ? (
          <video
            key={previewUrl}
            controls
            preload="metadata"
            src={previewUrl}
            style={{ width: '100%', maxHeight: 320 }}
          />
        ) : (
          <audio key={previewUrl} controls src={previewUrl} style={{ width: '100%' }} />
        )
      ) : (
        <Typography.Text type="secondary">
          {value ? `已选择${label}；编辑模式不加载旧媒体预览` : `尚未上传${label}`}
        </Typography.Text>
      )}
      {fileName && <Typography.Text type="secondary">{fileName}</Typography.Text>}
      {uploading && <Progress percent={percent} size="small" />}
      <Space>
        <Button disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>
          {value ? `更换${label}` : `上传${label}`}
        </Button>
        {uploading && (
          <Button danger onClick={cancelUpload}>
            取消上传
          </Button>
        )}
        {value && !uploading && (
          <Button type="link" danger disabled={disabled} onClick={clear}>
            清除
          </Button>
        )}
      </Space>
      <input
        ref={inputRef}
        type="file"
        hidden
        // 内联 display:none：AntD 表单重置样式会覆盖 hidden 属性，导致原生选择框可见
        style={{ display: 'none' }}
        accept={
          kind === 'video' ? 'video/mp4,video/webm,.mp4,.webm' : 'audio/mpeg,audio/mp4,.mp3,.m4a'
        }
        onChange={handleFileChange}
      />
    </Space>
  );
}
