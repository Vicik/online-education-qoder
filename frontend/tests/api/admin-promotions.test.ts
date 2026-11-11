import { http, HttpResponse } from 'msw';
import {
  cancelGroupon,
  createGroupon,
  listAdminGroupons,
  updateGroupon,
} from '@/api/admin/groupons';
import {
  cancelFlashSale,
  createFlashSale,
  listAdminFlashSales,
  updateFlashSale,
} from '@/api/admin/flash-sales';
import {
  createCouponTemplate,
  disableCouponTemplate,
  enableCouponTemplate,
  getCouponTemplate,
  listAdminCoupons,
  updateCouponTemplate,
} from '@/api/admin/coupons';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-admin-promo' };
}

// 拼团活动桩（含 version）
const groupon = {
  id: 1,
  courseId: 2,
  courseName: 'TypeScript 系统入门',
  name: '三人成团',
  priceCents: 9900,
  targetSize: 3,
  startAt: '2026-11-20T02:00:00.000Z',
  endAt: '2026-11-27T02:00:00.000Z',
  status: 'not_started',
  version: 2,
};

// 秒杀活动桩（含 remaining 与 version）
const flashSale = {
  id: 5,
  courseId: 2,
  courseName: 'TypeScript 系统入门',
  name: '限时秒杀',
  priceCents: 4900,
  stock: 50,
  sold: 3,
  remaining: 47,
  startAt: '2026-11-20T02:00:00.000Z',
  endAt: '2026-11-20T04:00:00.000Z',
  status: 'not_started',
  version: 4,
};

// 优惠券模板桩（含 version 与 courseIds）
const coupon = {
  id: 9,
  name: '满 100 减 20',
  discountCents: 2000,
  startAt: '2026-11-20T00:00:00.000Z',
  endAt: '2026-12-20T00:00:00.000Z',
  totalQty: 100,
  claimedCount: 0,
  status: 'disabled',
  courseIds: [2],
  version: 3,
};

describe('admin promotions api', () => {
  it('拼团列表透传分页，创建带幂等键，编辑带 version，取消路径正确', async () => {
    // 列表查询参数
    let query = new URLSearchParams();
    // 创建请求体
    let createBody: unknown = null;
    // 创建幂等键
    let createKey: string | null = null;
    // 编辑请求体
    let updateBody: unknown = null;
    // 取消访问的 URL
    let cancelUrl = '';

    server.use(
      http.get(/\/api\/v1\/admin\/groupons$/, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(
          envelope({ items: [groupon], total: 1, page: 2, pageSize: 10 }),
        );
      }),
      http.post(/\/api\/v1\/admin\/groupons$/, async ({ request }) => {
        createBody = await request.json();
        createKey = request.headers.get('idempotency-key');
        return HttpResponse.json(envelope(groupon), { status: 201 });
      }),
      http.put(/\/api\/v1\/admin\/groupons\/1$/, async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json(envelope({ ...groupon, version: 3 }));
      }),
      http.post(/\/api\/v1\/admin\/groupons\/1\/cancel$/, ({ request }) => {
        cancelUrl = request.url;
        return HttpResponse.json(envelope({ ...groupon, status: 'cancelled' }));
      }),
    );

    const page = await listAdminGroupons(2, 10);
    expect(query.get('page')).toBe('2');
    expect(query.get('pageSize')).toBe('10');
    expect(page.items[0].version).toBe(2);

    await createGroupon(
      {
        courseId: 2,
        name: '三人成团',
        priceCents: 9900,
        targetSize: 3,
        startAt: '2026-11-20T02:00:00.000Z',
        endAt: '2026-11-27T02:00:00.000Z',
      },
      'key-12345678',
    );
    expect(createKey).toBe('key-12345678');
    expect(createBody).toMatchObject({ courseId: 2, targetSize: 3 });

    await updateGroupon(1, { version: 2, name: '新名字' });
    expect(updateBody).toEqual({ version: 2, name: '新名字' });

    await cancelGroupon(1);
    expect(cancelUrl).toMatch(/\/admin\/groupons\/1\/cancel$/);
  });

  it('秒杀创建带幂等键，编辑带 version，取消路径正确', async () => {
    // 创建请求体
    let createBody: unknown = null;
    // 创建幂等键
    let createKey: string | null = null;
    // 编辑请求体
    let updateBody: unknown = null;
    // 取消访问的 URL
    let cancelUrl = '';

    server.use(
      http.get(/\/api\/v1\/admin\/flash-sales$/, () =>
        HttpResponse.json(
          envelope({ items: [flashSale], total: 1, page: 1, pageSize: 10 }),
        ),
      ),
      http.post(/\/api\/v1\/admin\/flash-sales$/, async ({ request }) => {
        createBody = await request.json();
        createKey = request.headers.get('idempotency-key');
        return HttpResponse.json(envelope(flashSale), { status: 201 });
      }),
      http.put(/\/api\/v1\/admin\/flash-sales\/5$/, async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json(envelope({ ...flashSale, version: 5 }));
      }),
      http.post(/\/api\/v1\/admin\/flash-sales\/5\/cancel$/, ({ request }) => {
        cancelUrl = request.url;
        return HttpResponse.json(envelope({ ...flashSale, status: 'cancelled' }));
      }),
    );

    const page = await listAdminFlashSales(1, 10);
    expect(page.items[0].remaining).toBe(47);

    await createFlashSale(
      {
        courseId: 2,
        name: '限时秒杀',
        priceCents: 4900,
        stock: 50,
        startAt: '2026-11-20T02:00:00.000Z',
        endAt: '2026-11-20T04:00:00.000Z',
      },
      'key-abcdefgh',
    );
    expect(createKey).toBe('key-abcdefgh');
    expect(createBody).toMatchObject({ stock: 50 });

    await updateFlashSale(5, { version: 4, stock: 40 });
    expect(updateBody).toEqual({ version: 4, stock: 40 });

    await cancelFlashSale(5);
    expect(cancelUrl).toMatch(/\/admin\/flash-sales\/5\/cancel$/);
  });

  it('优惠券筛选/创建/详情/编辑/启停路径与载荷正确', async () => {
    // 列表查询参数
    let query = new URLSearchParams();
    // 创建请求体
    let createBody: unknown = null;
    // 创建幂等键
    let createKey: string | null = null;
    // 编辑请求体
    let updateBody: unknown = null;
    // 访问过的 URL
    const urls: string[] = [];

    server.use(
      http.get(/\/api\/v1\/admin\/coupons$/, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(
          envelope({ items: [coupon], total: 1, page: 1, pageSize: 10 }),
        );
      }),
      http.post(/\/api\/v1\/admin\/coupons$/, async ({ request }) => {
        createBody = await request.json();
        createKey = request.headers.get('idempotency-key');
        return HttpResponse.json(envelope(coupon), { status: 201 });
      }),
      http.get(/\/api\/v1\/admin\/coupons\/9$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope(coupon));
      }),
      http.put(/\/api\/v1\/admin\/coupons\/9$/, async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json(envelope({ ...coupon, version: 4 }));
      }),
      http.post(/\/api\/v1\/admin\/coupons\/9\/enable$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope({ ...coupon, status: 'enabled' }));
      }),
      http.post(/\/api\/v1\/admin\/coupons\/9\/disable$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope(coupon));
      }),
    );

    const page = await listAdminCoupons(1, 10, 'disabled');
    expect(query.get('status')).toBe('disabled');
    expect(page.items[0].courseIds).toEqual([2]);

    await createCouponTemplate(
      {
        name: '满 100 减 20',
        discountCents: 2000,
        startAt: '2026-11-20T00:00:00.000Z',
        endAt: '2026-12-20T00:00:00.000Z',
        totalQty: 100,
        perUserLimit: 1,
        courseIds: [2],
        enableOnCreate: false,
      },
      'key-coupon12',
    );
    expect(createKey).toBe('key-coupon12');
    expect(createBody).toMatchObject({ courseIds: [2], enableOnCreate: false });

    const detail = await getCouponTemplate(9);
    expect(detail.version).toBe(3);

    await updateCouponTemplate(9, { version: 3, name: '改名' });
    expect(updateBody).toEqual({ version: 3, name: '改名' });

    await enableCouponTemplate(9);
    await disableCouponTemplate(9);
    expect(urls.some((url) => url.endsWith('/coupons/9/enable'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/coupons/9/disable'))).toBe(true);
  });
});
