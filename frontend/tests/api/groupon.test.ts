import { http, HttpResponse } from 'msw';
import {
  createGrouponGroup,
  getGroupon,
  joinGrouponGroup,
  listGroupons,
} from '@/api/promotion';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-groupon' };
}

// 活动桩
const activity = {
  id: 3,
  courseId: 1,
  courseName: 'TypeScript 系统入门',
  name: '双人成团',
  priceCents: 6900,
  targetSize: 2,
  startAt: '2026-11-01T00:00:00.000Z',
  endAt: '2026-12-01T00:00:00.000Z',
  status: 'ongoing',
};

// 团组桩
const group = {
  id: 8,
  status: 'pending',
  memberCount: 1,
  targetSize: 2,
  expiresAt: '2026-12-01T00:00:00.000Z',
  formedAt: null,
};

// 订单桩
const order = {
  id: 5,
  orderNo: 'NO5',
  courseId: 1,
  courseName: 'TypeScript 系统入门',
  activityType: 'groupon',
  activityId: 8,
  originalCents: 19900,
  currentCents: 6900,
  discountCents: 0,
  paidCents: 6900,
  couponClaimId: null,
  status: 'pending',
  paidAt: null,
  createdAt: '2026-11-10T00:00:00.000Z',
};

describe('groupon api', () => {
  it('列表透传分页参数', async () => {
    // 捕获页码
    let page = '';
    server.use(
      http.get(/\/api\/v1\/groupons$/, ({ request }) => {
        page = new URL(request.url).searchParams.get('page') ?? '';
        return HttpResponse.json(
          envelope({ items: [activity], total: 1, page: 2, pageSize: 12 }),
        );
      }),
    );

    const result = await listGroupons(2, 12);
    expect(page).toBe('2');
    expect(result.items[0].targetSize).toBe(2);
  });

  it('详情返回待成团团组', async () => {
    server.use(
      http.get(/\/api\/v1\/groupons\/3$/, () =>
        HttpResponse.json(envelope({ ...activity, groups: [group] })),
      ),
    );

    const detail = await getGroupon(3);
    expect(detail.groups).toHaveLength(1);
    expect(detail.groups[0].memberCount).toBe(1);
  });

  it('发起新团与参团均携带幂等键', async () => {
    // 发起新团的幂等键
    let createKey = '';
    // 参团的幂等键
    let joinKey = '';
    server.use(
      http.post(/\/api\/v1\/groupons\/3\/groups$/, ({ request }) => {
        createKey = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(envelope({ order, group }), { status: 201 });
      }),
      http.post(/\/api\/v1\/groupons\/3\/groups\/8\/join$/, ({ request }) => {
        joinKey = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(envelope({ order, group }), { status: 201 });
      }),
    );

    const created = await createGrouponGroup(3, 'key-create-123');
    const joined = await joinGrouponGroup(3, 8, 'key-join-1234');
    expect(createKey).toBe('key-create-123');
    expect(joinKey).toBe('key-join-1234');
    expect(created.order.id).toBe(5);
    expect(joined.order.activityId).toBe(8);
  });
});
