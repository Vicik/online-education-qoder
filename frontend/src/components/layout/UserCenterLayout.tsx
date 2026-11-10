import { Button, Layout, Menu } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { USER_CENTER_NAV_ITEMS, getUserCenterSelectedKey } from '@/app/navigation';
import { useLogout } from '@/hooks/useLogout';
import './layout.css';

const { Sider, Content } = Layout;

// 用户中心布局：220px 侧栏 + 内容卡片
export default function UserCenterLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useLogout();

  return (
    <Layout className="side-layout">
      <Sider width={220} className="side-sider">
        <Menu
          mode="inline"
          selectedKeys={[getUserCenterSelectedKey(location.pathname)]}
          items={USER_CENTER_NAV_ITEMS.map((item) => ({
            key: item.path,
            label: item.label,
            onClick: () => navigate(item.path),
          }))}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Content className="side-content">
        <div className="side-header">
          <h2 style={{ margin: 0 }}>用户中心</h2>
          <Button onClick={() => void logout()}>退出登录</Button>
        </div>
        <Outlet />
      </Content>
    </Layout>
  );
}
