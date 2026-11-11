import { request } from './client';
import type {
  CheckoutPreviewData,
  Order,
  OrderCreateRequest,
  PageResult,
} from './types';

// 预览参数：金额由服务端计算，客户端只传券与活动
export interface CheckoutQuery {
  couponId?: number;
  activityType?: 'normal' | 'groupon' | 'flash_sale';
  activityId?: number;
}

// 价格预览：未登录后端返回 401，路由层已保证登录
export function getCheckoutPreview(
  courseId: number,
  query: CheckoutQuery = {},
): Promise<CheckoutPreviewData> {
  return request<CheckoutPreviewData>({
    url: `/checkout/${courseId}/preview`,
    method: 'GET',
    params: query,
  });
}

// 创建订单：必须携带幂等键，重放返回首次结果
export function createOrder(
  payload: OrderCreateRequest,
  idempotencyKey: string,
): Promise<Order> {
  return request<Order>({
    url: '/orders',
    method: 'POST',
    data: payload,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 模拟支付：后端幂等，已支付返回首次结果
export function payOrder(orderId: number): Promise<Order> {
  return request<Order>({
    url: `/orders/${orderId}/pay`,
    method: 'POST',
  });
}

// 订单详情（支付结果页）
export function getOrder(orderId: number): Promise<Order> {
  return request<Order>({
    url: `/orders/${orderId}`,
    method: 'GET',
  });
}

// 购买记录分页
export function listMyOrders(
  page = 1,
  pageSize = 20,
): Promise<PageResult<Order>> {
  return request<PageResult<Order>>({
    url: '/user/orders',
    method: 'GET',
    params: { page, pageSize },
  });
}
