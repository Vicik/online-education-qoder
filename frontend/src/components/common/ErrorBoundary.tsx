import { Button, Result } from 'antd';
import { Component, type PropsWithChildren } from 'react';
import { ApiError } from '@/api/errors';

// 路由级错误边界：展示错误摘要、requestId 与重试
export class ErrorBoundary extends Component<PropsWithChildren, { error: Error | null }> {
  // 捕获到的渲染错误
  state = { error: null as Error | null };

  // 捕获子组件渲染错误
  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      // 业务错误携带的请求编号，便于排查
      const requestId =
        this.state.error instanceof ApiError ? this.state.error.requestId : undefined;
      return (
        <Result
          status="error"
          title="页面出错了"
          subTitle={requestId ? `请求编号：${requestId}` : '请稍后重试'}
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              重试
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
