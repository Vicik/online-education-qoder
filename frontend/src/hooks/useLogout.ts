import { useNavigate } from 'react-router';
import { logout } from '@/api/auth';
import { queryClient } from '@/app/query-client';
import { useSessionStore } from '@/stores/session';

// 登出：无论接口成败都清本地会话并回首页
export function useLogout(): () => Promise<void> {
  const clear = useSessionStore((state) => state.clear);
  const navigate = useNavigate();
  return async () => {
    try {
      await logout();
    } finally {
      clear();
      queryClient.clear();
      navigate('/');
    }
  };
}
