import { http, HttpResponse } from 'msw';
import {
  getFlashSale,
  listFlashSales,
  purchaseFlashSale,
} from '@/api/promotion';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-flash' };
}

// 秒杀活动桩（含服务端剩余库存）
const sale = {
  id: 6,
  courseId: 1,
  courseName: 'TypeScript 系统入门',
  name: '限时秒杀',
  priceCents: 4900,
  stock: 100,
  sold: 97,
  remaining: 2,
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2099-12-01T00:00:00.000Z',
  status: 'ongoing',
  version: 1,
};

// 订单桩
const order = {
  id: 7,
  orderNo: 'NO7',
  courseId: 1,
  courseName: 'TypeScript 系统入门',
  activityType: 'flash_sale',
  activityId: 6,
  originalCents: 19900,
  currentCents: 4900,
  discountCents: 0,
  paidCents: 4900,
  couponClaimId: null,
  status: 'pending',
  paidAt: null,
  createdAt: '2026-11-10T00:00:00.000Z',
};

describe('flash sale api', () => {
  it('列表返回剩余库存', async () => {
    server.use(
      http.get(/\/api\/v1\/flash-sales$/, () =>
        HttpResponse.json(envelope({ items: [sale], total: 1, page: 1, pageSize: 12 })),
      ),
    );

    const result = await listFlashSales(1, 12);
    expect(result.items[0].remaining).toBe(2);
  });

  it('详情返回售罄字段', async () => {
    server.use(
      http.get(/\/api\/v1\/flash-sales\/6$/, () =>
        HttpResponse.json(envelope({ ...sale, remaining: 0 })),
      ),
    );

    const detail = await getFlashSale(6);
    expect(detail.remaining).toBe(0);
  });

  it('下单携带幂等键并返回订单', async () => {
    // 捕获幂等键
    let key = '';
    server.use(
      http.post(/\/api\/v1\/flash-sales\/6\/purchase$/, ({ request }) => {
        key = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(envelope({ order }), { status: 201 });
      }),
    );

    const result = await purchaseFlashSale(6, 'key-flash-123');
    expect(key).toBe('key-flash-123');
    expect(result.order.activityType).toBe('flash_sale');
  });
});
