import { Button, Result, Space } from 'antd';
import { useNavigate } from 'react-router';

// 403：提供返回上一页与首页
export default function ForbiddenPage() {
  // 路由跳转
  const navigate = useNavigate();

  return (
    <Result
      status="403"
      title="无权访问"
      subTitle="你没有访问该页面的权限。"
      extra={
        <Space>
          <Button onClick={() => navigate(-1)}>返回上一页</Button>
          <Button type="primary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </Space>
      }
    />
  );
}
