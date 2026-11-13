import { Avatar, Button, Dropdown, Layout } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import { Link, useLocation, useNavigate } from 'react-router';
import { getUserNavItems, getUserNavSelectedKey } from '@/app/navigation';
import { useLogout } from '@/hooks/useLogout';
import { useSessionStore } from '@/stores/session';
import './layout.css';

const { Header } = Layout;

// 用户端顶部导航：品牌、主导航与账户入口（首页与用户中心共用）
export function UserHeader() {
  // 当前登录用户
  const user = useSessionStore((state) => state.user);
  // 当前路由
  const location = useLocation();
  // 路由跳转
  const navigate = useNavigate();
  // 退出登录
  const logout = useLogout();
  // 按角色过滤后的顶部导航项
  const navItems = getUserNavItems(user?.role ?? null);
  // 当前导航高亮：课程详情按活动来源，其余按路径前缀，无匹配时不选中
  const selectedKey = getUserNavSelectedKey(
    navItems,
    location.pathname,
    location.search,
  );
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
    <Header className="user-header">
      <div className="user-header-inner">
        <Link to="/" className="user-brand">
          知序课堂
        </Link>
        <nav className="user-nav" aria-label="主导航">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={
                selectedKey === item.path ? 'user-nav-link user-nav-link-active' : 'user-nav-link'
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="layout-account">
          {user ? (
            <Dropdown menu={{ items: accountItems }} placement="bottomRight">
              <button
                type="button"
                className="layout-avatar"
                aria-label={`${user.nickname || user.email || '用户'}的账户菜单`}
              >
                <Avatar size={36} src={user.avatarUrl ?? undefined} icon={<UserOutlined />} />
              </button>
            </Dropdown>
          ) : (
            <Button
              shape="circle"
              aria-label="登录"
              autoInsertSpace={false}
              style={{ width: 36, height: 36, padding: 0, fontSize: 12 }}
              onClick={() => navigate('/login')}
            >
              登录
            </Button>
          )}
        </div>
      </div>
    </Header>
  );
}
