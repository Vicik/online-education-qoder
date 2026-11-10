import { Empty } from 'antd';
import type { ReactNode } from 'react';

// 空态：文案 + 可选操作
export function EmptyState({ description, action }: { description: string; action?: ReactNode }) {
  return <Empty description={description}>{action}</Empty>;
}
