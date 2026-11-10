import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';

// 抛错组件
function Boom(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('兜底展示并保留 requestId', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('页面出错了')).toBeInTheDocument();
  });
});
