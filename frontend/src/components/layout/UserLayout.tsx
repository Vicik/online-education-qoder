import { Layout } from 'antd';
import { Outlet } from 'react-router';
import { SkipLink } from './SkipLink';
import { UserHeader } from './UserHeader';
import './layout.css';

const { Content, Footer } = Layout;

// 用户端布局：顶部导航 + 1200px 居中内容 + 页脚
export default function UserLayout() {
  return (
    <Layout className="user-layout">
      <SkipLink />
      <UserHeader />
      <Content className="user-content">
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </Content>
      <Footer style={{ textAlign: 'center', color: '#8c8c8c' }}>知序课堂 · 演示环境</Footer>
    </Layout>
  );
}
