import { http, HttpResponse } from 'msw';
import {
  addFavorite,
  getCourseDetail,
  listCourses,
  listFavoriteIds,
} from '@/api/catalog';
import { server } from '../msw/server';

// 统一成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-catalog' };
}

// 课程桩数据：仅填测试断言所需字段
function course(id: number) {
  return {
    id,
    name: `课程 ${id}`,
    type: 'video',
    coverKey: null,
    coverUrl: null,
    instructor: '讲师',
    originalCents: 19900,
    saleCents: 9900,
    status: 'published',
  };
}

describe('catalog api', () => {
  it('课程列表透传 page/pageSize 并返回分页结构', async () => {
    let receivedPage = '';
    server.use(
      http.get(/\/api\/v1\/courses$/, ({ request }) => {
        receivedPage = new URL(request.url).searchParams.get('page') ?? '';
        return HttpResponse.json(
          envelope({ items: [course(1)], total: 1, page: 1, pageSize: 12 }),
        );
      }),
    );

    const result = await listCourses({ page: 1, pageSize: 12 });
    expect(receivedPage).toBe('1');
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('课程详情返回 CourseDetail', async () => {
    server.use(
      http.get(/\/api\/v1\/courses\/1$/, () =>
        HttpResponse.json(
          envelope({
            ...course(1),
            intro: '简介',
            detailRich: '<p>详情</p>',
            chapters: [],
            groupon: null,
            flashSale: null,
            claimableCoupons: [],
          }),
        ),
      ),
    );

    const detail = await getCourseDetail(1);
    expect(detail.name).toBe('课程 1');
    expect(detail.chapters).toEqual([]);
  });

  it('收藏携带 Idempotency-Key', async () => {
    let receivedKey = '';
    server.use(
      http.post(/\/api\/v1\/favorites$/, ({ request }) => {
        receivedKey = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(envelope(null), { status: 201 });
      }),
    );

    await addFavorite(1, 'idem-key-0001');
    expect(receivedKey).toBe('idem-key-0001');
  });

  it('收藏 id 全集按页扫描，超过 100 条继续取下一页', async () => {
    const requests: string[] = [];
    server.use(
      http.get(/\/api\/v1\/user\/favorites$/, ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get('page'));
        requests.push(`${page}`);
        const items =
          page === 1
            ? Array.from({ length: 100 }, (_, index) => course(index + 1))
            : [course(101)];
        return HttpResponse.json(
          envelope({ items, total: 101, page, pageSize: 100 }),
        );
      }),
    );

    const ids = await listFavoriteIds();
    expect(ids.size).toBe(101);
    expect(requests).toEqual(['1', '2']);
  });
});
