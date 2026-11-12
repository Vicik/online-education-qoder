import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp, Button } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { SkipLink } from '@/components/layout/SkipLink';
import { ConfirmAction } from '@/components/common/ConfirmAction';

describe('键盘可达性', () => {
  it('跳过导航链接指向主内容', () => {
    render(<SkipLink />);
    expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });

  it('确认弹窗打开后焦点进入弹窗，Esc 关闭且不触发确认', async () => {
    // 确认回调
    const onConfirm = vi.fn();

    render(
      <AntdApp>
        <ConfirmAction title="发布课程" onConfirm={onConfirm}>
          <Button>发布</Button>
        </ConfirmAction>
      </AntdApp>,
    );

    await userEvent.click(screen.getByRole('button', { name: /发\s*布/ }));
    // 弹窗容器
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // userEvent 的 Escape 不带旧版 keyCode，而 rc-dialog 以 keyCode 27 识别 Esc
    fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 27, which: 27 });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
