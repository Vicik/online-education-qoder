import { request } from '../client';
import type {
  AdminFlashSale,
  FlashSaleCreateInput,
  FlashSaleUpdateInput,
  PageResult,
} from '../types';

// 秒杀活动列表：后端不支持状态筛选
export function listAdminFlashSales(
  page = 1,
  pageSize = 10,
): Promise<PageResult<AdminFlashSale>> {
  return request<PageResult<AdminFlashSale>>({
    url: '/admin/flash-sales',
    method: 'GET',
    params: { page, pageSize },
  });
}

// 创建秒杀活动：创建类 POST 携带幂等键
export function createFlashSale(
  input: FlashSaleCreateInput,
  idempotencyKey: string,
): Promise<AdminFlashSale> {
  return request<AdminFlashSale>({
    url: '/admin/flash-sales',
    method: 'POST',
    data: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 编辑秒杀活动：仅未开始，version 必带
export function updateFlashSale(
  activityId: number,
  input: FlashSaleUpdateInput,
): Promise<AdminFlashSale> {
  return request<AdminFlashSale>({
    url: `/admin/flash-sales/${activityId}`,
    method: 'PUT',
    data: input,
  });
}

// 取消秒杀活动：仅未开始，openapi 未声明请求体
export function cancelFlashSale(activityId: number): Promise<AdminFlashSale> {
  return request<AdminFlashSale>({
    url: `/admin/flash-sales/${activityId}/cancel`,
    method: 'POST',
  });
}
