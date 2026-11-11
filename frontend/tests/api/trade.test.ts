import { http, HttpResponse } from 'msw';
import { createOrder, getCheckoutPreview } from '@/api/trade';
import { server } from '../msw/server';

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-trade' };
}

describe('trade api', () => {
  it('预览透传券参数', async () => {
    let couponId = '';
    server.use(
      http.get(/\/api\/v1\/checkout\/1\/preview$/, ({ request }) => {
        couponId = new URL(request.url).searchParams.get('couponId') ?? '';
        return HttpResponse.json(
          envelope({
            courseId: 1,
            activityType: 'normal',
            activityId: null,
            originalCents: 19900,
            currentCents: 9900,
            discountCents: 2000,
            paidCents: 7900,
            couponClaimId: 9,
          }),
        );
      }),
    );

    const preview = await getCheckoutPreview(1, { couponId: 9 });
    expect(couponId).toBe('9');
    expect(preview.paidCents).toBe(7900);
  });

  it('创建订单携带 Idempotency-Key', async () => {
    let key = '';
    server.use(
      http.post(/\/api\/v1\/orders$/, ({ request }) => {
        key = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(
          envelope({
            id: 1,
            orderNo: 'ZX202611100001',
            courseId: 1,
            courseName: 'TypeScript 系统入门',
            activityType: 'normal',
            activityId: null,
            originalCents: 19900,
            currentCents: 9900,
            discountCents: 0,
            paidCents: 9900,
            couponClaimId: null,
            status: 'pending',
            paidAt: null,
            createdAt: '2026-11-10T02:00:00.000Z',
          }),
          { status: 201 },
        );
      }),
    );

    const order = await createOrder({ courseId: 1, activityType: 'normal' }, 'idem-order-0001');
    expect(key).toBe('idem-order-0001');
    expect(order.orderNo).toBe('ZX202611100001');
  });
});
