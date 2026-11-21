import { cleanup, screen } from '@testing-library/react';
import UserLayout from '@/components/layout/UserLayout';
import { useSessionStore } from '@/stores/session';
import { renderWithProviders } from '../utils/render';

// 管理员会话桩
const ADMIN = {
  id: 9,
  email: 'admin@example.com',
  nickname: '管理员',
  role: 'admin' as const,
  avatarKey: null,
  avatarUrl: null,
  gender: 'secret' as const,
};

// 布局嵌套路由：管理端预览页与普通详情页各一条
const routes = [
  {
    path: '/admin/courses/:id/preview',
    element: <UserLayout />,
    children: [{ index: true, element: <div>preview-body</div> }],
  },
  {
    path: '/courses/:id',
    element: <UserLayout />,
    children: [{ index: true, element: <div>course-body</div> }],
  },
];

describe('UserLayout', () => {
  afterEach(() => {
    // 先卸载组件再清空登录态，避免已挂载组件在 act 外更新
    cleanup();
    useSessionStore.setState({ user: null });
  });

  it('管理员课程预览隐藏主导航但保留品牌与头像', () => {
    useSessionStore.setState({ user: ADMIN });

    renderWithProviders(routes, '/admin/courses/1/preview');

    expect(screen.getByText('preview-body')).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: '主导航' }),
    ).not.toBeInTheDocument();
    // 品牌与账户头像仍展示
    expect(screen.getByRole('link', { name: '知序课堂' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '管理员的账户菜单' }),
    ).toBeInTheDocument();
  });

  it('普通课程详情展示用户端导航', () => {
    renderWithProviders(routes, '/courses/1');

    expect(screen.getByText('course-body')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
  });
});
