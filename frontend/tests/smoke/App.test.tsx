import { render, screen } from '@testing-library/react';
import App from '@/App';

// 冒烟测试：应用可挂载并渲染产品名
describe('App', () => {
  it('渲染产品名「知序课堂」', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '知序课堂' })).toBeInTheDocument();
  });
});
