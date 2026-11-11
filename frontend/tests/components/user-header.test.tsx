import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { UserHeader } from '@/components/layout/UserHeader';
import { useSessionStore } from '@/stores/session';

// 顶部导航：游客登录入口
describe('UserHeader', () => {
  afterEach(() => {
    useSessionStore.getState().clear();
  });

  it('游客登录入口为圆形文字按钮，不显示图标', () => {
    const { container } = render(
      <MemoryRouter>
        <UserHeader />
      </MemoryRouter>,
    );

    const button = screen.getByRole('button', { name: '登录' });
    expect(button).toHaveTextContent('登录');
    expect(button.className).toContain('ant-btn-circle');
    expect(container.querySelector('.anticon-login')).toBeNull();
  });
});
