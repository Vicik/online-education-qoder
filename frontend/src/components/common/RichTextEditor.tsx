import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { App as AntdApp, Button, Space } from 'antd';
import { useEffect, useRef, type ChangeEvent } from 'react';
import { uploadImage, type UploadResult } from '@/api/files';
import { isAllowedImage } from '@/lib/validators';
import { sanitizeRichHtml, serializeRichHtmlForSave } from '@/lib/sanitize';

// 带 data-key 的图片扩展：保存 key，展示签名 URL
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

// 富文本编辑器：标题/加粗/斜体/列表/链接/图片/表格
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
  onUploadImage?: (file: File) => Promise<UploadResult>;
}) {
  const { message } = AntdApp.useApp();
  // 隐藏的文件选择器引用：工具栏「图片」按钮触发
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [
      // StarterKit v3 已内置 Link，统一在此配置，避免重复注册
      StarterKit.configure({ link: { openOnClick: false } }),
      KeyedImage,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Placeholder.configure({ placeholder }),
    ],
    content: value ?? '',
    editable: !disabled,
    editorProps: {
      // Word 粘贴：保留语义结构并清理 Office 标记/不安全内容
      transformPastedHTML: (html) => sanitizeRichHtml(html),
    },
    onUpdate: ({ editor: instance }) => {
      // 对外只暴露可保存的序列化结果：图片 src 回写为 key、表格截断
      onChange?.(serializeRichHtmlForSave(instance.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    // 比较序列化结果：避免父组件回写 key 化 HTML 时把签名 URL 覆盖掉
    if (value !== undefined && serializeRichHtmlForSave(editor.getHTML()) !== value) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    // 只读态切换：编辑器挂载后再同步可编辑状态
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // 选择图片：预检类型/大小后上传，插入带 key 的图片
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    // 取出首个文件，并立即清空以便重复选择同一文件
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!isAllowedImage(file)) {
      message.error('图片仅支持 PNG/JPEG/WebP，且不超过 2MB');
      return;
    }
    try {
      // 上传结果：key 持久化，url 用于即时预览
      const result = await onUploadImage(file);
      editor
        ?.chain()
        .focus()
        .insertContent({
          type: 'image',
          attrs: { src: result.url, 'data-key': result.key, alt: file.name },
        })
        .run();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片上传失败');
    }
  }

  if (!editor) return null;

  return (
    <div style={{ border: '1px solid #ebedf0', borderRadius: 6 }}>
      <Space wrap style={{ padding: 8, borderBottom: '1px solid #ebedf0' }}>
        <Button
          size="small"
          type={editor.isActive('bold') ? 'primary' : 'default'}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          加粗
        </Button>
        <Button
          size="small"
          type={editor.isActive('italic') ? 'primary' : 'default'}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          斜体
        </Button>
        <Button
          size="small"
          type={editor.isActive('bulletList') ? 'primary' : 'default'}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          列表
        </Button>
        <Button
          size="small"
          type={editor.isActive('orderedList') ? 'primary' : 'default'}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          编号
        </Button>
        <Button
          size="small"
          disabled={disabled}
          onClick={() => {
            // 链接地址由用户输入；为空则取消设置
            const href = window.prompt('请输入链接地址');
            if (href) editor.chain().focus().setLink({ href }).run();
          }}
        >
          链接
        </Button>
        <Button size="small" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
          图片
        </Button>
        <Button
          size="small"
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          表格
        </Button>
      </Space>
      <div style={{ padding: 12, minHeight: 160 }}>
        <EditorContent editor={editor} />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={handleFileChange}
      />
    </div>
  );
}
