import type { components } from './schema';
import { request } from './client';

// 会话用户类型
export type SessionUser = components['schemas']['User'];

// 当前用户；/auth/me 探测不触发全局跳登录
export function getMe(): Promise<SessionUser> {
  return request<SessionUser>({ url: '/auth/me', method: 'GET', skipAuthRedirect: true });
}

// 退出登录
export function logout(): Promise<null> {
  return request<null>({ url: '/auth/logout', method: 'POST' });
}
