import { Button, Dropdown, Layout, Menu } from 'antd';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { getUserNavItems } from '@/app/navigation';
import { useLogout } from '@/hooks/useLogout';
import { useSessionStore } from '@/stores/session';
import './layout.css';

const { Header, Content, Footer } = Layout;

// 用户端布局：顶部导航 + 账户入口
export default function UserLayout() {
  const user = useSessionStore((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();
  const logout = useLogout();
  const navItems = getUserNavItems(user?.role ?? null);
  // 当前导航高亮：根路径精确匹配，其余按前缀匹配
  const selectedKey =
    navItems.find((item) =>
      item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path),
    )?.path ?? '/';
  // 已登录账户下拉项
  const accountItems = user
    ? [
        {
          key: 'home',
          label: user.role === 'admin' ? '管理端' : '个人中心',
          onClick: () => navigate(user.role === 'admin' ? '/admin' : '/user'),
        },
        { key: 'logout', label: '退出登录', onClick: () => void logout() },
      ]
    : [];

  return (
    <Layout>
      <Header className="user-header">
        <Link to="/" className="user-brand">
          知序课堂
        </Link>
        <Menu
          className="user-nav"
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={navItems.map((item) => ({
            key: item.path,
            label: <Link to={item.path}>{item.label}</Link>,
          }))}
        />
        <div className="layout-account">
          {user ? (
            <Dropdown menu={{ items: accountItems }}>
              <Button type="link">{user.nickname || user.email}</Button>
            </Dropdown>
          ) : (
            <Button type="link" onClick={() => navigate('/login')}>
              登录
            </Button>
          )}
        </div>
      </Header>
      <Content className="user-content">
        <Outlet />
      </Content>
      <Footer style={{ textAlign: 'center', color: '#8c8c8c' }}>知序课堂 · 演示环境</Footer>
    </Layout>
  );
}
