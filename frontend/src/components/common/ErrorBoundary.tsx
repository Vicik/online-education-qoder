import { Button, Result, Space } from 'antd';
import { Component, type PropsWithChildren } from 'react';
import { ApiError } from '@/api/errors';

// 路由级错误边界：展示错误摘要、requestId、重试与首页入口
export class ErrorBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  // 捕获到的渲染错误
  state = { error: null as Error | null };

  // 子组件抛错时转为状态
  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      // 可追踪的请求编号（非接口错误时为空）
      const requestId =
        this.state.error instanceof ApiError ? this.state.error.requestId : undefined;
      return (
        <Result
          status="error"
          title="页面出错了"
          subTitle={requestId ? `请求编号：${requestId}` : '请稍后重试'}
          extra={
            <Space>
              <Button type="primary" onClick={() => window.location.reload()}>
                重试
              </Button>
              <Button onClick={() => window.location.assign('/')}>返回首页</Button>
            </Space>
          }
        />
      );
    }
    return this.props.children;
  }
}
