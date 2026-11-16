import { request } from '../client';
import type { DashboardStats } from '../types';

// 工作台统计：管理员专用
export function getDashboardStats(): Promise<DashboardStats> {
  return request<DashboardStats>({
    url: '/admin/dashboard/stats',
    method: 'GET',
  });
}
