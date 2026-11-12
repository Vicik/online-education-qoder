import { Button, Layout, Menu } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { ADMIN_NAV_ITEMS, getAdminSelectedKey } from '@/app/navigation';
import { useLogout } from '@/hooks/useLogout';
import { SkipLink } from './SkipLink';
import './layout.css';

const { Sider, Content } = Layout;

// 管理端布局：220px 侧栏 + 内容区；子路由按模块前缀高亮
export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useLogout();

  return (
    <Layout className="side-layout">
      <SkipLink />
      <Sider width={220} className="side-sider">
        <div style={{ padding: '20px 24px', fontSize: 18, fontWeight: 600, color: '#1677ff' }}>
          知序课堂 · 管理端
        </div>
        <Menu
          mode="inline"
          selectedKeys={[getAdminSelectedKey(location.pathname)]}
          items={ADMIN_NAV_ITEMS.map((item) => ({
            key: item.path,
            label: item.label,
            onClick: () => navigate(item.path),
          }))}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Content className="side-content">
        <div className="side-header">
          <h2 style={{ margin: 0 }}>管理端</h2>
          <Button onClick={() => void logout()}>退出登录</Button>
        </div>
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </Content>
    </Layout>
  );
}
