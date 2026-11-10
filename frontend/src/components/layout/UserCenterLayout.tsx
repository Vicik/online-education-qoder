import { Layout, Menu } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { USER_CENTER_NAV_ITEMS, getUserCenterSelectedKey } from '@/app/navigation';
import { UserHeader } from './UserHeader';
import './layout.css';

const { Sider, Content } = Layout;

// 用户中心布局：顶部导航 + 220px 侧栏 + 内容卡片
export default function UserCenterLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout className="user-center-page">
      <UserHeader />
      <Layout className="side-layout user-center-layout">
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
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
