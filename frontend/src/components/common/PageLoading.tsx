import { Spin } from 'antd';

// 路由懒加载兜底
export function PageLoading() {
  return (
    <div className="full-page-loading">
      <Spin size="large" />
    </div>
  );
}
