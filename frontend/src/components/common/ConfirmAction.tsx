import { App as AntdApp } from 'antd';
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';

// 触发器可接受的属性
interface TriggerProps {
  onClick?: () => void;
  disabled?: boolean;
}

// 二次确认：取消不回调；确认期间由 Modal 自动 loading
export function ConfirmAction({
  title,
  content,
  okText = '确定',
  cancelText = '取消',
  danger,
  disabled,
  onConfirm,
  children,
}: {
  title: string;
  content?: ReactNode;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => Promise<void> | void;
  children: ReactElement<TriggerProps>;
}) {
  // AntD 上下文中的 modal 与消息提示
  const { modal, message } = AntdApp.useApp();

  // 打开确认框
  function open() {
    modal.confirm({
      title,
      content,
      okText,
      cancelText,
      okButtonProps: { danger },
      onOk: async () => {
        try {
          await onConfirm();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '操作失败');
          throw error;
        }
      },
    });
  }

  if (!isValidElement(children)) return null;
  return cloneElement(children, {
    onClick: open,
    disabled: disabled || children.props.disabled,
  });
}
