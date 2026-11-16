import type { components } from './schema';
import { request } from './client';

// 会话用户类型
export type SessionUser = components['schemas']['User'];

// 登录请求：管理员与普通用户共用，仅邮箱与密码
export interface LoginPayload {
  email: string;
  password: string;
}

// 注册请求
export interface RegisterPayload {
  email: string;
  password: string;
  confirmPassword: string;
  nickname: string;
}

// 当前用户；/auth/me 探测不触发全局跳登录
export function getMe(): Promise<SessionUser> {
  return request<SessionUser>({ url: '/auth/me', method: 'GET', skipAuthRedirect: true });
}

// 会话心跳：真实交互时续期 30 分钟空闲窗口；静默请求不显示加载遮罩
export function heartbeat(): Promise<null> {
  return request<null>({
    url: '/auth/heartbeat',
    method: 'POST',
    skipRequestActivity: true,
  });
}

// 登录：角色由账号携带，前端不选择角色
export function login(payload: LoginPayload): Promise<SessionUser> {
  return request<SessionUser>({
    url: '/auth/login',
    method: 'POST',
    data: payload,
    skipAuthRedirect: true,
  });
}

// 注册：成功不自动登录
export function register(payload: RegisterPayload): Promise<null> {
  return request<null>({
    url: '/auth/register',
    method: 'POST',
    data: payload,
    skipAuthRedirect: true,
  });
}

// 退出登录
export function logout(): Promise<null> {
  return request<null>({ url: '/auth/logout', method: 'POST' });
}

// 修改密码：成功后后端吊销全部会话，前端需清会话并重新登录
export function changePassword(payload: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  return request<void>({
    url: '/auth/password',
    method: 'POST',
    data: payload,
  });
}
