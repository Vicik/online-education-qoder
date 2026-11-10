import { Button, Result } from 'antd';
import { useNavigate } from 'react-router';

// 403：提供返回首页
export default function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="403"
      title="无权访问"
      subTitle="当前账号没有访问该页面的权限。"
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          返回首页
        </Button>
      }
    />
  );
}
