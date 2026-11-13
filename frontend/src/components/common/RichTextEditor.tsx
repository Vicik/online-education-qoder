import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  ClearOutlined,
  CloudUploadOutlined,
  ColumnWidthOutlined,
  DeleteColumnOutlined,
  DeleteOutlined,
  DeleteRowOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  ItalicOutlined,
  LinkOutlined,
  MinusOutlined,
  OrderedListOutlined,
  PictureOutlined,
  PlusOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  TableOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Color } from '@tiptap/extension-color';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { TextAlign } from '@tiptap/extension-text-align';
import { FontSize, LineHeight, TextStyle } from '@tiptap/extension-text-style';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button, ColorPicker, Input, Modal, Progress, Select, Tabs, Tooltip } from 'antd';
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  uploadImage,
  type UploadImageOptions,
  type UploadResult,
} from '@/api/files';
import { isAllowedImage } from '@/lib/validators';
import { sanitizeRichHtml, serializeRichHtmlForSave } from '@/lib/sanitize';
import './RichTextEditor.css';

// 带 data-key 的图片扩展：编辑时展示公开 URL，保存时序列化为资源 key
const KeyedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-key': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-key'),
        renderHTML: (attributes) =>
          attributes['data-key'] ? { 'data-key': attributes['data-key'] } : {},
      },
    };
  },
});

// 标题层级：保留 h1-h6，旧内容中的四级以上标题不会在编辑时降级
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

// 段落格式值
type ParagraphValue = 'p' | `h${HeadingLevel}` | 'blockquote';

// 段落格式选项
const PARAGRAPH_OPTIONS: Array<{ value: ParagraphValue; label: string }> = [
  { value: 'p', label: '正文' },
  { value: 'h1', label: '标题 1' },
  { value: 'h2', label: '标题 2' },
  { value: 'h3', label: '标题 3' },
  { value: 'h4', label: '标题 4' },
  { value: 'h5', label: '标题 5' },
  { value: 'h6', label: '标题 6' },
  { value: 'blockquote', label: '引用' },
];

// 字号选项：与常见 Word 字号档位对齐
const FONT_SIZE_OPTIONS = [
  { value: '', label: '默认' },
  { value: '12px', label: '12' },
  { value: '14px', label: '14' },
  { value: '16px', label: '16' },
  { value: '18px', label: '18' },
  { value: '20px', label: '20' },
  { value: '24px', label: '24' },
  { value: '28px', label: '28' },
  { value: '32px', label: '32' },
];

// 行距选项
const LINE_HEIGHT_OPTIONS = [
  { value: '', label: '默认' },
  { value: '1', label: '1.0' },
  { value: '1.5', label: '1.5' },
  { value: '1.75', label: '1.75' },
  { value: '2', label: '2.0' },
];

// 文字颜色预设：偏文档场景，避免过饱和
const COLOR_PRESETS = [
  '#1f2329',
  '#4e5969',
  '#86909c',
  '#c9302c',
  '#d46b08',
  '#d48806',
  '#389e0d',
  '#08979c',
  '#0958d9',
  '#531dab',
];

// 图片上传状态
type UploadState = 'idle' | 'uploading' | 'done' | 'error';

// 图片插入方式
type ImageTab = 'local' | 'url';

// 工具按钮属性
interface ToolButtonProps {
  label: string; // 悬浮提示与无障碍名称
  active?: boolean; // 当前选区是否已应用该格式
  disabled?: boolean; // 只读或按钮不可用
  onClick: () => void; // 点击行为
  children: ReactNode; // 图标
}

// 工具按钮：图标 + 悬浮提示 + 选中态
function ToolButton({ label, active, disabled, onClick, children }: ToolButtonProps) {
  return (
    <Tooltip title={label}>
      <button
        type="button"
        className={active ? 'rte__tool rte__tool--active' : 'rte__tool'}
        aria-label={label}
        aria-pressed={Boolean(active)}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

// 判断是否为 http(s) 地址
function isHttpUrl(value: string): boolean {
  try {
    // 解析结果用于校验协议，避免误插 javascript: 等地址
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// 读取当前块级格式
function currentParagraph(editor: Editor): ParagraphValue {
  // 标题 1-6
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    if (editor.isActive('heading', { level })) return `h${level}`;
  }
  // 引用块
  if (editor.isActive('blockquote')) return 'blockquote';
  // 默认为正文
  return 'p';
}

// 应用块级格式
function applyParagraph(editor: Editor, value: ParagraphValue) {
  if (value === 'p') {
    editor.chain().focus().setParagraph().run();
    return;
  }
  if (value === 'blockquote') {
    editor.chain().focus().setBlockquote().run();
    return;
  }
  // 标题：从值里取层级
  const level = Number(value.slice(1)) as HeadingLevel;
  editor.chain().focus().setHeading({ level }).run();
}

// 富文本编辑器：百度风格工具栏、图片上传弹窗与状态栏
export function RichTextEditor({
  value,
  onChange,
  placeholder = '请输入内容',
  disabled,
  onUploadImage = uploadImage,
}: {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onUploadImage?: (file: File, options?: UploadImageOptions) => Promise<UploadResult>;
}) {
  // 图片弹窗开关
  const [imageOpen, setImageOpen] = useState(false);
  // 当前图片插入方式
  const [imageTab, setImageTab] = useState<ImageTab>('local');
  // 已选择的本地图片
  const [imageFile, setImageFile] = useState<File | null>(null);
  // 预览地址：上传中为对象地址，成功后换成服务端地址
  const [imagePreview, setImagePreview] = useState('');
  // 上传进度
  const [imageProgress, setImageProgress] = useState(0);
  // 上传状态
  const [imageState, setImageState] = useState<UploadState>('idle');
  // 上传错误或取消提示
  const [imageError, setImageError] = useState('');
  // 上传结果：key 持久化，url 用于插入
  const [imageResult, setImageResult] = useState<UploadResult | null>(null);
  // 图片描述
  const [imageAlt, setImageAlt] = useState('');
  // 网络图片地址
  const [imageUrl, setImageUrl] = useState('');
  // 链接弹窗开关
  const [linkOpen, setLinkOpen] = useState(false);
  // 链接地址
  const [linkUrl, setLinkUrl] = useState('');
  // 链接错误提示
  const [linkError, setLinkError] = useState('');
  // 全屏编辑
  const [fullscreen, setFullscreen] = useState(false);
  // 正文字数（不含空白）
  const [charCount, setCharCount] = useState(0);
  // 上传取消句柄
  const abortRef = useRef<AbortController | null>(null);
  // 预览对象地址：关闭弹窗时回收
  const previewUrlRef = useRef('');
  // 本地图片选择框
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 编辑器实例：扩展与保存序列化集中在这里
  const editor = useEditor({
    extensions: [
      // StarterKit v3 已内置 Link/Underline/HorizontalRule
      StarterKit.configure({
        link: { openOnClick: false },
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      KeyedImage.configure({ allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({ placeholder }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      FontSize,
      LineHeight,
      Color,
    ],
    content: value ?? '',
    editable: !disabled,
    editorProps: {
      // Word 粘贴：保留语义结构并清理 Office 标记/不安全内容
      transformPastedHTML: (html) => sanitizeRichHtml(html),
    },
    // 选区变化也触发重渲染，保证工具栏选中态实时更新
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: instance }) => {
      // 对外只暴露可保存的序列化结果：图片 src 回写为 key、表格截断
      onChange?.(serializeRichHtmlForSave(instance.getHTML()));
      // 同步字数统计
      setCharCount(instance.getText().replace(/\s+/g, '').length);
    },
  });

  useEffect(() => {
    // 首次挂载即统计已有内容的字数
    if (!editor || editor.isDestroyed) return;
    setCharCount(editor.getText().replace(/\s+/g, '').length);
  }, [editor]);

  useEffect(() => {
    // StrictMode 双挂载时会以已销毁实例重跑 effect，此时 schema 已被置空
    if (!editor || editor.isDestroyed) return;
    // 比较序列化结果：避免父组件回写 key 化 HTML 时把公开 URL 覆盖掉
    if (value !== undefined && serializeRichHtmlForSave(editor.getHTML()) !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
      setCharCount(editor.getText().replace(/\s+/g, '').length);
    }
  }, [editor, value]);

  useEffect(() => {
    // 同上：跳过已销毁实例，避免在 schema 置空后调用命令
    if (!editor || editor.isDestroyed) return;
    // 只读态切换：第二个参数为 false，避免把可编辑性变化当成内容更新回调给父组件
    editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  useEffect(() => {
    // 非全屏时无需绑定
    if (!fullscreen) return;
    // Esc 退出全屏
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    // 锁定页面滚动
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  useEffect(() => {
    // 组件卸载时取消上传并回收预览地址
    return () => {
      abortRef.current?.abort();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  // 清空图片弹窗状态
  function resetImage() {
    abortRef.current?.abort();
    abortRef.current = null;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setImageFile(null);
    setImagePreview('');
    setImageProgress(0);
    setImageState('idle');
    setImageError('');
    setImageResult(null);
    setImageAlt('');
    setImageUrl('');
  }

  // 打开图片弹窗
  function openImageModal() {
    resetImage();
    setImageTab('local');
    setImageOpen(true);
  }

  // 关闭图片弹窗
  function closeImageModal() {
    resetImage();
    setImageOpen(false);
  }

  // 开始上传本地图片
  async function startUpload(file: File) {
    // 先取消上一笔上传
    abortRef.current?.abort();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    // 本地对象地址：上传期间即时预览
    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;
    setImageFile(file);
    setImagePreview(previewUrl);
    setImageAlt('');
    setImageProgress(0);
    setImageState('uploading');
    setImageError('');
    setImageResult(null);
    // 本次上传的取消句柄
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // 上传结果：key 持久化，url 用于插入
      const result = await onUploadImage(file, {
        onProgress: (percent) => setImageProgress(percent),
        signal: controller.signal,
      });
      // 已被取消或关闭弹窗：丢弃结果
      if (controller.signal.aborted) return;
      setImageResult(result);
      setImagePreview(result.url);
      setImageProgress(100);
      setImageState('done');
    } catch (error) {
      // 主动取消不算失败
      if (controller.signal.aborted) {
        setImageState('error');
        setImageError('已取消上传');
        return;
      }
      setImageState('error');
      setImageError(error instanceof Error ? error.message : '图片上传失败');
    }
  }

  // 选择本地图片
  function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    // 取出首个文件，并立即清空以便重复选择同一文件
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!isAllowedImage(file)) {
      setImageState('error');
      setImageError('图片仅支持 PNG/JPEG/WebP，且不超过 2MB');
      return;
    }
    void startUpload(file);
  }

  // 取消当前上传
  function cancelUpload() {
    abortRef.current?.abort();
  }

  // 切换图片插入方式
  function switchImageTab(key: string) {
    if (key === imageTab) return;
    // 切到网络图片时停止本地上传
    cancelUpload();
    setImageTab(key as ImageTab);
    setImageError('');
  }

  // 插入本地图片
  function insertLocalImage() {
    if (!editor || !imageResult) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'image',
        attrs: {
          src: imageResult.url,
          alt: imageAlt.trim() || imageFile?.name || '图片',
          'data-key': imageResult.key,
        },
      })
      .run();
    closeImageModal();
  }

  // 插入网络图片
  function insertNetworkImage() {
    if (!editor) return;
    // 去掉首尾空白
    const url = imageUrl.trim();
    if (!isHttpUrl(url)) {
      setImageError('请输入 http/https 开头的图片地址');
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'image',
        attrs: { src: url, alt: imageAlt.trim() || '图片' },
      })
      .run();
    closeImageModal();
  }

  // 点击底部「插入正文」：按当前方式插入
  function insertImage() {
    if (imageTab === 'local') insertLocalImage();
    else insertNetworkImage();
  }

  // 打开链接弹窗
  function openLinkModal() {
    setLinkUrl((editor?.getAttributes('link').href as string | undefined) ?? '');
    setLinkError('');
    setLinkOpen(true);
  }

  // 应用链接
  function applyLink() {
    if (!editor) return;
    // 去掉首尾空白
    const url = linkUrl.trim();
    if (!isHttpUrl(url)) {
      setLinkError('请输入 http/https 开头的链接地址');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    setLinkOpen(false);
  }

  // 移除链接
  function removeLink() {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkOpen(false);
  }

  // 编辑器尚未创建时先占位
  if (!editor) return null;

  // 当前段落格式
  const paragraphValue = currentParagraph(editor);
  // 当前文字样式属性
  const textStyleAttrs = editor.getAttributes('textStyle');
  // 当前文字颜色
  const currentColor = textStyleAttrs.color as string | undefined;
  // 当前字号
  const fontSize = (textStyleAttrs.fontSize as string | undefined) ?? '';
  // 当前行距
  const lineHeight = (textStyleAttrs.lineHeight as string | undefined) ?? '';
  // 段落数：顶层块数量
  const paragraphCount = editor.state.doc.childCount;

  // 图片弹窗底部按钮
  const imageFooter = [
    imageState === 'uploading' ? (
      <Button key="cancel-upload" danger onClick={cancelUpload}>
        取消上传
      </Button>
    ) : null,
    imageState === 'error' && imageFile ? (
      <Button key="retry" onClick={() => void startUpload(imageFile)}>
        重新上传
      </Button>
    ) : null,
    <Button key="close" onClick={closeImageModal}>
      取消
    </Button>,
    <Button
      key="insert"
      type="primary"
      disabled={imageTab === 'local' && imageState !== 'done'}
      onClick={insertImage}
    >
      插入正文
    </Button>,
  ];

  return (
    <div className={fullscreen ? 'rte rte--fullscreen' : 'rte'}>
      <div className="rte__toolbar" role="toolbar" aria-label="编辑工具栏">
        {/* 历史 */}
        <ToolButton
          label="撤销"
          disabled={disabled || !editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <UndoOutlined />
        </ToolButton>
        <ToolButton
          label="重做"
          disabled={disabled || !editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <RedoOutlined />
        </ToolButton>
        <span className="rte__divider" />
        {/* 块级格式 */}
        <Select<ParagraphValue>
          size="small"
          className="rte__select rte__select--block"
          value={paragraphValue}
          options={PARAGRAPH_OPTIONS}
          disabled={disabled}
          aria-label="段落格式"
          onChange={(next) => applyParagraph(editor, next)}
        />
        <Select
          size="small"
          className="rte__select"
          value={fontSize}
          options={FONT_SIZE_OPTIONS}
          disabled={disabled}
          aria-label="字号"
          onChange={(next) => {
            if (next) editor.chain().focus().setFontSize(next).run();
            else editor.chain().focus().unsetFontSize().run();
          }}
        />
        <Select
          size="small"
          className="rte__select"
          value={lineHeight}
          options={LINE_HEIGHT_OPTIONS}
          disabled={disabled}
          aria-label="行距"
          onChange={(next) => {
            if (next) editor.chain().focus().setLineHeight(next).run();
            else editor.chain().focus().unsetLineHeight().run();
          }}
        />
        <span className="rte__divider" />
        {/* 行内格式 */}
        <ToolButton
          label="加粗"
          active={editor.isActive('bold')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <BoldOutlined />
        </ToolButton>
        <ToolButton
          label="斜体"
          active={editor.isActive('italic')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <ItalicOutlined />
        </ToolButton>
        <ToolButton
          label="下划线"
          active={editor.isActive('underline')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineOutlined />
        </ToolButton>
        <ToolButton
          label="删除线"
          active={editor.isActive('strike')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <StrikethroughOutlined />
        </ToolButton>
        <ColorPicker
          value={currentColor ?? '#1f2329'}
          presets={[{ label: '常用颜色', colors: COLOR_PRESETS }]}
          disabled={disabled}
          onChangeComplete={(color) =>
            editor.chain().focus().setColor(color.toHexString()).run()
          }
        >
          <button
            type="button"
            className="rte__tool"
            aria-label="文字颜色"
            disabled={disabled}
          >
            <span
              className="rte__color"
              style={{ backgroundColor: currentColor ?? '#1f2329' }}
            />
          </button>
        </ColorPicker>
        <span className="rte__divider" />
        {/* 对齐 */}
        <ToolButton
          label="左对齐"
          active={editor.isActive({ textAlign: 'left' })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        >
          <AlignLeftOutlined />
        </ToolButton>
        <ToolButton
          label="居中对齐"
          active={editor.isActive({ textAlign: 'center' })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        >
          <AlignCenterOutlined />
        </ToolButton>
        <ToolButton
          label="右对齐"
          active={editor.isActive({ textAlign: 'right' })}
          disabled={disabled}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        >
          <AlignRightOutlined />
        </ToolButton>
        <span className="rte__divider" />
        {/* 列表与引用 */}
        <ToolButton
          label="无序列表"
          active={editor.isActive('bulletList')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <UnorderedListOutlined />
        </ToolButton>
        <ToolButton
          label="有序列表"
          active={editor.isActive('orderedList')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <OrderedListOutlined />
        </ToolButton>
        <ToolButton
          label="引用"
          active={editor.isActive('blockquote')}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <span className="rte__quote">“</span>
        </ToolButton>
        <span className="rte__divider" />
        {/* 插入 */}
        <ToolButton label="插入链接" disabled={disabled} onClick={openLinkModal}>
          <LinkOutlined />
        </ToolButton>
        <ToolButton label="插入图片" disabled={disabled} onClick={openImageModal}>
          <PictureOutlined />
        </ToolButton>
        <ToolButton
          label="插入表格"
          disabled={disabled}
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <TableOutlined />
        </ToolButton>
        <ToolButton
          label="分割线"
          disabled={disabled}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <MinusOutlined />
        </ToolButton>
        <span className="rte__divider" />
        {/* 清理与全屏 */}
        <ToolButton
          label="清除格式"
          disabled={disabled}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          <ClearOutlined />
        </ToolButton>
        <ToolButton
          label={fullscreen ? '退出全屏' : '全屏编辑'}
          active={fullscreen}
          disabled={disabled}
          onClick={() => setFullscreen((previous) => !previous)}
        >
          {fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
        </ToolButton>
      </div>

      {editor.isActive('table') && (
        <div className="rte__toolbar rte__toolbar--table" role="toolbar" aria-label="表格工具栏">
          <ToolButton
            label="在下方插入行"
            disabled={disabled}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            <PlusOutlined />
          </ToolButton>
          <ToolButton
            label="在右侧插入列"
            disabled={disabled}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            <ColumnWidthOutlined />
          </ToolButton>
          <ToolButton
            label="删除当前行"
            disabled={disabled}
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            <DeleteRowOutlined />
          </ToolButton>
          <ToolButton
            label="删除当前列"
            disabled={disabled}
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            <DeleteColumnOutlined />
          </ToolButton>
          <ToolButton
            label="删除表格"
            disabled={disabled}
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <DeleteOutlined />
          </ToolButton>
        </div>
      )}

      <div className="rte__canvas">
        <EditorContent editor={editor} />
      </div>

      <div className="rte__status">
        <span>字数 {charCount}</span>
        <span>段落 {paragraphCount}</span>
        <span>Word 中的图片请用『插入图片』上传</span>
      </div>

      <Modal
        open={imageOpen}
        title="插入图片"
        width={520}
        onCancel={closeImageModal}
        footer={imageFooter}
        destroyOnHidden
      >
        <Tabs
          activeKey={imageTab}
          onChange={switchImageTab}
          items={[
            {
              key: 'local',
              label: '本地上传',
              children: (
                <div className="rte-upload">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={handleImageFileChange}
                  />
                  <button
                    type="button"
                    className="rte-upload__drop"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <CloudUploadOutlined className="rte-upload__icon" />
                    <span>点击选择图片</span>
                    <span className="rte-upload__hint">支持 PNG/JPEG/WebP，单张不超过 2MB</span>
                  </button>
                  {imagePreview && (
                    <div className="rte-upload__preview">
                      <img src={imagePreview} alt="待插入图片" />
                    </div>
                  )}
                  {imageState === 'uploading' && (
                    <div className="rte-upload__progress">
                      <Progress percent={imageProgress} size="small" />
                      <span>正在上传…</span>
                    </div>
                  )}
                  {imageState === 'error' && imageError && (
                    <div className="rte-upload__error">{imageError}</div>
                  )}
                  {imageState === 'done' && (
                    <div className="rte-upload__done">上传完成，点击「插入正文」加入编辑器</div>
                  )}
                  <Input
                    placeholder="图片描述（可选）"
                    value={imageAlt}
                    onChange={(event) => setImageAlt(event.target.value)}
                  />
                </div>
              ),
            },
            {
              key: 'url',
              label: '网络图片',
              children: (
                <div className="rte-upload">
                  <Input
                    placeholder="请输入 http/https 图片地址"
                    value={imageUrl}
                    onChange={(event) => {
                      setImageUrl(event.target.value);
                      setImageError('');
                    }}
                  />
                  <Input
                    placeholder="图片描述（可选）"
                    value={imageAlt}
                    onChange={(event) => setImageAlt(event.target.value)}
                  />
                  {imageError && <div className="rte-upload__error">{imageError}</div>}
                </div>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={linkOpen}
        title="插入链接"
        onCancel={() => setLinkOpen(false)}
        onOk={applyLink}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          placeholder="请输入 http/https 链接地址"
          value={linkUrl}
          onChange={(event) => {
            setLinkUrl(event.target.value);
            setLinkError('');
          }}
          onPressEnter={applyLink}
        />
        {linkError && <div className="rte-upload__error">{linkError}</div>}
        {editor.isActive('link') && (
          <Button className="rte__unlink" size="small" onClick={removeLink}>
            移除链接
          </Button>
        )}
      </Modal>
    </div>
  );
}
