import { http, HttpResponse } from 'msw';
import { claimCoupon, listCourseCoupons } from '@/api/promotion';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-coupon' };
}

describe('promotion api', () => {
  it('课程可领券返回模板数组', async () => {
    server.use(
      http.get(/\/api\/v1\/courses\/1\/coupons$/, () =>
        HttpResponse.json(
          envelope([
            {
              id: 9,
              name: '新学员立减券',
              discountCents: 2000,
              startAt: '2026-11-01T00:00:00.000Z',
              endAt: '2026-12-31T00:00:00.000Z',
              totalQty: 100,
              claimedCount: 3,
              status: 'enabled',
              courseIds: [1],
            },
          ]),
        ),
      ),
    );

    const coupons = await listCourseCoupons(1);
    expect(coupons).toHaveLength(1);
    expect(coupons[0].discountCents).toBe(2000);
  });

  it('领券携带 Idempotency-Key 并返回领取记录', async () => {
    // 捕获幂等键
    let key = '';
    server.use(
      http.post(/\/api\/v1\/coupons\/9\/claim$/, ({ request }) => {
        key = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(
          envelope({
            id: 21,
            templateId: 9,
            templateName: '新学员立减券',
            discountCents: 2000,
            startAt: '2026-11-01T00:00:00.000Z',
            endAt: '2026-12-31T00:00:00.000Z',
            courseIds: [1],
            status: 'unused',
            claimedAt: '2026-11-10T00:00:00.000Z',
            usedAt: null,
          }),
          { status: 201 },
        );
      }),
    );

    const claim = await claimCoupon(9, 'key-12345678');
    expect(key).toBe('key-12345678');
    expect(claim.id).toBe(21);
    expect(claim.status).toBe('unused');
  });
});
