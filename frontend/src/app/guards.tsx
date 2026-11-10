import type { ComponentType, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { SessionUser } from '@/stores/session';
import { useSessionStore } from '@/stores/session';

// 角色：普通用户 / 管理员
export type Role = 'user' | 'admin';

// 布局键：四套布局各对应一组路由
export type LayoutKey = 'auth' | 'user' | 'user-center' | 'admin';

// 懒加载页面工厂
export type LazyPage = () => Promise<{ default: ComponentType }>;

// 路由元信息：权限只在这里声明
export interface RouteMeta {
  path: string; // 路由路径（含动态参数）
  layout: LayoutKey; // 所属布局
  requiresAuth: boolean; // 是否要求登录
  roles?: Role[]; // 允许进入的角色；缺省表示不限
  lazy: LazyPage; // 页面懒加载入口
}

// 按优先级判定跳转目标；返回 null 表示放行
export function resolveRedirect(
  user: SessionUser | null,
  meta: RouteMeta,
  path: string,
): string | null {
  // 1. 管理员隔离：非 /admin 路由一律回管理端（/admin/login 除外）
  if (user?.role === 'admin' && !path.startsWith('/admin')) return '/admin';
  // 2. 未登录访问受保护路由：带原地址去登录
  if (meta.requiresAuth && !user) return `/login?redirect=${encodeURIComponent(path)}`;
  // 3. 已登录但角色不匹配（role 缺省视为无权限）
  if (meta.roles && user && (!user.role || !meta.roles.includes(user.role))) return '/403';
  return null;
}

// 路由守卫：命中跳转就重定向，否则渲染子节点
export function GuardedRoute({ meta, children }: { meta: RouteMeta; children: ReactNode }) {
  const user = useSessionStore((state) => state.user);
  const location = useLocation();
  const currentPath = `${location.pathname}${location.search}`;
  const redirect = resolveRedirect(user, meta, currentPath);
  if (redirect) return <Navigate to={redirect} replace />;
  return <>{children}</>;
}
