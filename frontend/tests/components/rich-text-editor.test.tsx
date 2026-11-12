import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import type { ComponentProps } from 'react';
import { RichTextEditor } from '@/components/common/RichTextEditor';
import type { UploadImageOptions, UploadResult } from '@/api/files';

// 渲染编辑器：antd 的 message/modal 需要 App 上下文
function renderEditor(props: ComponentProps<typeof RichTextEditor> = {}) {
  return render(
    <AntdApp>
      <RichTextEditor {...props} />
    </AntdApp>,
  );
}

// 打开图片弹窗
async function openImageModal() {
  fireEvent.click(screen.getByRole('button', { name: '插入图片' }));
  return screen.findByRole('dialog');
}

// 选择本地图片
function chooseLocalFile(dialog: HTMLElement, file: File) {
  const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe('RichTextEditor', () => {
  it('工具栏按分组渲染，禁用时所有按钮不可用', () => {
    const { container } = renderEditor({ disabled: true });

    expect(screen.getByRole('toolbar', { name: '编辑工具栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加粗' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '插入图片' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '全屏编辑' })).toBeDisabled();
    // 分组分隔线：撤销/块级/行内/对齐/列表/插入/清理各成一组
    expect(container.querySelectorAll('.rte__divider').length).toBeGreaterThanOrEqual(5);
  });

  it('旧 HTML 内容可直接渲染，且不会回写 onChange', () => {
    const onChange = vi.fn();
    const { container } = renderEditor({
      value: '<p>旧内容</p><img src="files/a.png" data-key="a.png" alt="旧图">',
      onChange,
    });

    expect(screen.getByText('旧内容')).toBeInTheDocument();
    expect(container.querySelector('.ProseMirror img')?.getAttribute('data-key')).toBe('a.png');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('旧内容中的四级标题不会被降级为正文', () => {
    const { container } = renderEditor({ value: '<h4>四级标题</h4><p>正文</p>' });

    expect(container.querySelector('.ProseMirror h4')?.textContent).toBe('四级标题');
  });

  it('本地图片上传展示进度，插入后保存 key', async () => {
    // 待完成的上传
    let finishUpload: (result: UploadResult) => void = () => {};
    // 捕获上传参数
    let captured: UploadImageOptions | undefined;
    const onUploadImage = vi.fn(
      (_file: File, options?: UploadImageOptions) =>
        new Promise<UploadResult>((resolve) => {
          captured = options;
          options?.onProgress?.(42);
          finishUpload = resolve;
        }),
    );
    const onChange = vi.fn();
    renderEditor({ onUploadImage, onChange });

    const dialog = await openImageModal();
    chooseLocalFile(dialog, new File(['x'], 'a.png', { type: 'image/png' }));

    await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
    expect(captured?.signal).toBeInstanceOf(AbortSignal);
    expect(await screen.findByText('42%')).toBeInTheDocument();

    await act(async () => {
      finishUpload({ key: 'image/2026/11/a.png', url: 'blob:preview' });
    });
    expect(await screen.findByAltText('待插入图片')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '插入正文' }));

    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] as string;
      expect(html).toContain('data-key="image/2026/11/a.png"');
      expect(html).toContain('src="image/2026/11/a.png"');
    });
  });

  it('上传中可以取消，取消后不上传结果', async () => {
    // 捕获上传参数
    let captured: UploadImageOptions | undefined;
    const onUploadImage = vi.fn(
      (_file: File, options?: UploadImageOptions) =>
        new Promise<UploadResult>((_resolve, reject) => {
          captured = options;
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('上传已取消', 'AbortError')),
          );
        }),
    );
    const onChange = vi.fn();
    renderEditor({ onUploadImage, onChange });

    const dialog = await openImageModal();
    chooseLocalFile(dialog, new File(['x'], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(onUploadImage).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: '取消上传' }));

    await waitFor(() => expect(captured?.signal?.aborted).toBe(true));
    expect(await screen.findByText('已取消上传')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('网络图片插入后不带 data-key', async () => {
    const onChange = vi.fn();
    renderEditor({ onChange });

    const dialog = await openImageModal();
    fireEvent.click(within(dialog).getByRole('tab', { name: '网络图片' }));
    fireEvent.change(await screen.findByPlaceholderText('请输入 http/https 图片地址'), {
      target: { value: 'https://cdn.test/a.png' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '插入正文' }));

    await waitFor(() => {
      const html = onChange.mock.calls.at(-1)?.[0] as string;
      expect(html).toContain('src="https://cdn.test/a.png"');
      expect(html).not.toContain('data-key');
    });
  });

  it('网络图片拒绝非 http/https 地址', async () => {
    const onChange = vi.fn();
    renderEditor({ onChange });

    const dialog = await openImageModal();
    fireEvent.click(within(dialog).getByRole('tab', { name: '网络图片' }));
    fireEvent.change(await screen.findByPlaceholderText('请输入 http/https 图片地址'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '插入正文' }));

    expect(await screen.findByText('请输入 http/https 开头的图片地址')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('非法本地图片不发起上传', async () => {
    const onUploadImage = vi.fn();
    renderEditor({ onUploadImage });

    const dialog = await openImageModal();
    chooseLocalFile(dialog, new File(['x'], 'a.gif', { type: 'image/gif' }));

    expect(await screen.findByText('图片仅支持 PNG/JPEG/WebP，且不超过 2MB')).toBeInTheDocument();
    expect(onUploadImage).not.toHaveBeenCalled();
  });

  it('链接弹窗校验地址协议', async () => {
    renderEditor({ value: '<p>链接文字</p>' });

    fireEvent.click(screen.getByRole('button', { name: '插入链接' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('请输入 http/https 链接地址'), {
      target: { value: 'javascript:alert(1)' },
    });
    // antd 会在两个汉字之间插入空格
    fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));

    expect(await screen.findByText('请输入 http/https 开头的链接地址')).toBeInTheDocument();
  });
});
