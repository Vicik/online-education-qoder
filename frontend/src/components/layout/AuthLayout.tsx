import { Outlet } from 'react-router';
import './layout.css';

// 认证页布局：浅灰背景 + 居中卡片
export default function AuthLayout() {
  return (
    <div className="auth-layout">
      <div className="auth-card">
        <Outlet />
      </div>
    </div>
  );
}
