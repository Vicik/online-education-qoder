import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/errors';
import { AppTable } from '@/components/common/AppTable';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import ForbiddenPage from '@/features/auth/ForbiddenPage';

// 渲染即抛错的组件：用于触发错误边界
function Boom(): never {
  throw new ApiError(5000, '服务异常', null, 'req-e2e-500', 500);
}

describe('全局错误与空态', () => {
  beforeEach(() => {
    // React 会把捕获的错误打到 console.error，测试中屏蔽噪音
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('错误边界展示 requestId、重试与返回首页', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('页面出错了')).toBeInTheDocument();
    expect(screen.getByText('请求编号：req-e2e-500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回首页' })).toBeInTheDocument();
  });

  it('403 提供返回上一页与返回首页', () => {
    render(
      <MemoryRouter initialEntries={['/403']}>
        <ForbiddenPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('无权访问')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回上一页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回首页' })).toBeInTheDocument();
  });

  it('列表加载失败展示重试并回调', async () => {
    // 重试回调
    const onRetry = vi.fn();

    render(
      <AppTable<{ id: number }>
        columns={[]}
        dataSource={[]}
        rowKey="id"
        total={0}
        page={1}
        pageSize={10}
        error={new Error('boom')}
        onRetry={onRetry}
        onPageChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
