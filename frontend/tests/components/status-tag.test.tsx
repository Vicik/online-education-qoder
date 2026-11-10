import { render, screen } from '@testing-library/react';
import { StatusTag } from '@/components/common/StatusTag';

describe('StatusTag', () => {
  it('按领域映射文案', () => {
    const { rerender } = render(<StatusTag domain="course" status="draft" />);
    expect(screen.getByText('草稿')).toBeInTheDocument();
    rerender(<StatusTag domain="order" status="pending" />);
    expect(screen.getByText('待支付')).toBeInTheDocument();
    rerender(<StatusTag domain="group" status="pending" />);
    expect(screen.getByText('待成团')).toBeInTheDocument();
    rerender(<StatusTag domain="coupon" status="restored" />);
    expect(screen.getByText('未使用')).toBeInTheDocument();
  });
  it('未知状态回退原文', () => {
    render(<StatusTag domain="course" status="unknown-state" />);
    expect(screen.getByText('unknown-state')).toBeInTheDocument();
  });
});
