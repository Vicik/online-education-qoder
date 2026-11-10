import { useSessionStore } from '@/stores/session';

// 角色判断：仅用于展示，不作为安全边界
export function usePermission() {
  // 当前会话用户
  const user = useSessionStore((state) => state.user);
  // 是否管理员
  const isAdmin = user?.role === 'admin';
  // 是否普通用户
  const isUser = user?.role === 'user';
  // 是否命中指定角色；未登录或角色不匹配返回 false
  const can = (roles?: Array<'user' | 'admin'>) =>
    !!user && (!roles || (user.role !== undefined && roles.includes(user.role)));
  return { user, isAdmin, isUser, can };
}
