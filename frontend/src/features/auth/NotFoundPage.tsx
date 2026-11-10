import { Button, Result } from 'antd';
import { useNavigate } from 'react-router';

// 404：返回首页
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="链接可能已失效。"
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          返回首页
        </Button>
      }
    />
  );
}
