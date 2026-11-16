import { useRef, useState, type ChangeEvent } from 'react';
import { Button, Input, message } from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  LoadingOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { uploadImage } from '@/api/files';
import { createPost, extractBlockedWords } from '@/api/community';
import type { PostBrief } from '@/api/types';
import { PageHeader } from '@/components/common/PageHeader';
import { ImagePreview } from '@/components/common/ImagePreview';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { isAllowedImage } from '@/lib/validators';
import './NewPostPage.css';

// 单帖最多图片数
const MAX_IMAGES = 9;
// 正文长度上限：与后端校验保持一致
const MAX_CONTENT_LENGTH = 2000;

// 已上传图片：key 用于提交，url 用于预览
interface UploadedImage {
  key: string;
  url: string;
}

// HTML 转义：正文按纯文本输入，避免注入标签
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 组装帖子富文本：逐行成段，图片按 data-key 追加在正文之后
function buildPostContent(text: string, images: UploadedImage[]): string {
  // 去掉首尾空白后的正文
  const trimmed = text.trim();
  // 段落 HTML：保留用户输入的换行
  const paragraphs = trimmed
    ? trimmed
        .split('\n')
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')
    : '';
  // 图片 HTML：src 先写 key，由后端按 data-key 重写为公开地址
  const imageTags = images
    .map(
      (image) =>
        `<img src="${escapeHtml(image.key)}" data-key="${escapeHtml(image.key)}" alt="帖子图片">`,
    )
    .join('');
  return `${paragraphs}${imageTags}`;
}

// 发帖页：纯文本 + 图片上传，幂等提交，屏蔽词命中列出全部词
export default function NewPostPage() {
  // 路由跳转
  const navigate = useNavigate();
  // 查询缓存
  const queryClient = useQueryClient();
  // 帖子正文（纯文本）
  const [text, setText] = useState('');
  // 已上传图片
  const [images, setImages] = useState<UploadedImage[]>([]);
  // 图片是否上传中
  const [uploading, setUploading] = useState(false);
  // 正文为空的内联错误
  const [textError, setTextError] = useState('');
  // 当前预览的图片地址，null 表示未打开
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 隐藏的文件选择器
  const inputRef = useRef<HTMLInputElement>(null);

  // 发帖：一次意图一个幂等键
  const mutation = useIdempotentMutation<PostBrief, { content: string }>(
    (vars, key) => createPost(vars, key),
    {
      onSuccess: (created) => {
        message.success('发布成功');
        void queryClient.invalidateQueries({ queryKey: ['posts'] });
        navigate(`/community/${created.id}`);
      },
      onError: (error) => {
        // 屏蔽词命中时列出全部命中词
        const words = extractBlockedWords(error);
        message.error(words.length > 0 ? `内容包含屏蔽词：${words.join('、')}` : error.message);
      },
    },
  );

  // 选择图片：预检后逐张上传，成功的追加到列表
  async function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    // 本次选择的文件
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    // 剩余可上传数量
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      message.warning(`最多上传 ${MAX_IMAGES} 张图片`);
      return;
    }
    if (files.length > remaining) {
      message.warning(`最多上传 ${MAX_IMAGES} 张图片，已忽略多余文件`);
    }
    setUploading(true);
    try {
      for (const file of files.slice(0, remaining)) {
        if (!isAllowedImage(file)) {
          message.error('图片仅支持 PNG/JPEG/WebP，且不超过 2MB');
          continue;
        }
        try {
          // 上传结果：key 持久化，url 用于缩略图预览
          const result = await uploadImage(file);
          setImages((prev) => [...prev, { key: result.key, url: result.url }]);
        } catch (error) {
          message.error(error instanceof Error ? error.message : '图片上传失败');
        }
      }
    } finally {
      setUploading(false);
    }
  }

  // 移除已上传图片
  function removeImage(key: string) {
    setImages((prev) => prev.filter((image) => image.key !== key));
  }

  // 提交：正文为空时不发送，展示内联错误
  function handleSubmit() {
    if (text.trim().length === 0) {
      setTextError('帖子内容不能为空');
      return;
    }
    // 组装后的富文本：含段落与图片标签，需再校验一次后端长度上限
    const content = buildPostContent(text, images);
    if (content.length > MAX_CONTENT_LENGTH) {
      message.error('帖子内容过长，请精简文字或减少图片');
      return;
    }
    mutation.mutate({ content });
  }

  return (
    <div className="new-post-page">
      <PageHeader
        title="发布帖子"
        extra={
          <Button autoInsertSpace={false} onClick={() => navigate(-1)}>
            返回
          </Button>
        }
      />
      <div className="new-post-card">
        <Input.TextArea
          className="new-post-textarea"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (textError) setTextError('');
          }}
          placeholder="请填写帖子内容"
          autoSize={{ minRows: 7, maxRows: 20 }}
          maxLength={MAX_CONTENT_LENGTH}
          status={textError ? 'error' : undefined}
        />
        {textError && <p className="new-post-error">{textError}</p>}
        <div className="new-post-images">
          {images.map((image) => (
            <div className="new-post-thumb" key={image.key}>
              <img
                src={image.url}
                alt="帖子图片"
                onClick={() => setPreviewUrl(image.url)}
              />
              <div className="new-post-thumb-actions">
                <button
                  type="button"
                  aria-label="预览图片"
                  onClick={() => setPreviewUrl(image.url)}
                >
                  <EyeOutlined />
                </button>
                <button
                  type="button"
                  aria-label="删除图片"
                  onClick={() => removeImage(image.key)}
                >
                  <DeleteOutlined />
                </button>
              </div>
            </div>
          ))}
          {images.length < MAX_IMAGES && (
            <button
              type="button"
              className="new-post-add"
              aria-label="添加图片"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? <LoadingOutlined /> : <PlusOutlined />}
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          // 内联 display:none：AntD 表单重置样式会覆盖 hidden 属性，导致原生选择框可见
          style={{ display: 'none' }}
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFilesChange}
        />
      </div>
      <div className="new-post-actions">
        <Button
          type="primary"
          autoInsertSpace={false}
          className="new-post-submit"
          loading={mutation.isPending}
          disabled={uploading}
          onClick={handleSubmit}
        >
          发布
        </Button>
      </div>
      <ImagePreview
        src={previewUrl}
        alt="帖子图片"
        onClose={() => setPreviewUrl(null)}
      />
    </div>
  );
}
