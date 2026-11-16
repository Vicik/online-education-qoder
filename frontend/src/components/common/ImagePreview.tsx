import { useEffect } from 'react';
import { Modal } from 'antd';
import './ImagePreview.css';

// 图片预览：在当前页以弹窗展示大图，遮罩点击、Esc 或关闭按钮均可退出
export function ImagePreview({
  src,
  alt,
  onClose,
}: {
  src: string | null;
  alt?: string;
  onClose: () => void;
}) {
  // 打开期间监听 Esc：焦点不在弹窗内时 antd 自带的 Esc 处理不会触发
  useEffect(() => {
    if (!src) return;
    // 按下 Esc 时关闭预览
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [src, onClose]);

  return (
    <Modal
      open={Boolean(src)}
      footer={null}
      title={null}
      centered
      width="auto"
      onCancel={onClose}
      className="image-preview-modal"
      styles={{
        mask: { background: 'rgba(0, 0, 0, 0.45)' },
        content: { padding: 0, background: 'transparent', boxShadow: 'none' },
      }}
    >
      {src && <img className="image-preview-img" src={src} alt={alt ?? '图片预览'} />}
    </Modal>
  );
}
