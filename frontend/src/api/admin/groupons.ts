import { request } from '../client';
import type {
  AdminGroupon,
  GrouponCreateInput,
  GrouponUpdateInput,
  PageResult,
} from '../types';

// 拼团活动列表：后端不支持状态筛选
export function listAdminGroupons(
  page = 1,
  pageSize = 10,
): Promise<PageResult<AdminGroupon>> {
  return request<PageResult<AdminGroupon>>({
    url: '/admin/groupons',
    method: 'GET',
    params: { page, pageSize },
  });
}

// 创建拼团活动：创建类 POST 携带幂等键
export function createGroupon(
  input: GrouponCreateInput,
  idempotencyKey: string,
): Promise<AdminGroupon> {
  return request<AdminGroupon>({
    url: '/admin/groupons',
    method: 'POST',
    data: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 编辑拼团活动：仅未开始，version 必带
export function updateGroupon(
  activityId: number,
  input: GrouponUpdateInput,
): Promise<AdminGroupon> {
  return request<AdminGroupon>({
    url: `/admin/groupons/${activityId}`,
    method: 'PUT',
    data: input,
  });
}

// 取消拼团活动：仅未开始，openapi 未声明请求体
export function cancelGroupon(activityId: number): Promise<AdminGroupon> {
  return request<AdminGroupon>({
    url: `/admin/groupons/${activityId}/cancel`,
    method: 'POST',
  });
}
