import { Empty } from 'antd';

// 路由占位页：后续步骤替换为真实页面
export function PagePlaceholder({ title }: { title: string }) {
  return <Empty description={`${title}（建设中）`} />;
}
