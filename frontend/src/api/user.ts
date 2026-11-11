import { request } from './client';
import type { OverviewData, ProfileData } from './types';

// 个人资料：邮箱只读
export function getProfile(): Promise<ProfileData> {
  return request<ProfileData>({
    url: '/user/profile',
    method: 'GET',
  });
}

// 修改资料：avatarUrl 传对象存储 key（兼容历史 http 地址），null 表示清空
export function updateProfile(payload: {
  nickname: string;
  avatarUrl: string | null;
  gender: 'male' | 'female' | 'secret';
}): Promise<void> {
  return request<void>({
    url: '/user/profile',
    method: 'PUT',
    data: payload,
  });
}

// 学习概览统计
export function getOverview(): Promise<OverviewData> {
  return request<OverviewData>({
    url: '/user/overview',
    method: 'GET',
  });
}
