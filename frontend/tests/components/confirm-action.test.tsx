import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App as AntdApp, Button } from 'antd';
import { ConfirmAction } from '@/components/common/ConfirmAction';

// 包一层 AntD App 以使用 modal
function renderConfirm(onConfirm: () => Promise<void>) {
  render(
    <AntdApp>
      <ConfirmAction title="确认删除？" onConfirm={onConfirm}>
        <Button>删除</Button>
      </ConfirmAction>
    </AntdApp>,
  );
}

describe('ConfirmAction', () => {
  it('取消不触发，确认触发一次', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderConfirm(onConfirm);
    await userEvent.click(screen.getByRole('button', { name: /删\s*除/ }));
    const cancelButton = await screen.findByRole('button', { name: /取\s*消/ });
    expect(cancelButton.textContent).toBe('取消');
    await userEvent.click(cancelButton);
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /删\s*除/ }));
    const okButton = await screen.findByRole('button', { name: /确\s*定/ });
    expect(okButton.textContent).toBe('确定');
    await userEvent.click(okButton);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
