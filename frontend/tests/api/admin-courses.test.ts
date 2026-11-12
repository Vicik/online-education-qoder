import { http, HttpResponse } from 'msw';
import {
  addChapter,
  createCourse,
  deleteChapter,
  getAdminCourse,
  listAdminCourses,
  publishCourse,
  reorderChapters,
  unpublishCourse,
  updateCourse,
} from '@/api/admin/courses';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-admin-course' };
}

// 管理端课程列表行桩
const listItem = {
  id: 1,
  name: 'TypeScript 系统入门',
  type: 'video',
  coverKey: null,
  coverUrl: null,
  instructor: '张老师',
  originalCents: 19900,
  saleCents: 9900,
  status: 'draft',
  chapterCount: 2,
  enrollmentCount: 3,
};

describe('admin courses api', () => {
  it('列表透传分页与状态筛选', async () => {
    // 捕获查询参数
    let query = new URLSearchParams();
    server.use(
      http.get(/\/api\/v1\/admin\/courses$/, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(
          envelope({ items: [listItem], total: 1, page: 1, pageSize: 10 }),
        );
      }),
    );

    const result = await listAdminCourses(1, 10, 'draft');
    expect(query.get('page')).toBe('1');
    expect(query.get('pageSize')).toBe('10');
    expect(query.get('status')).toBe('draft');
    expect(result.items[0].chapterCount).toBe(2);
  });

  it('创建携带幂等键并返回 id/version', async () => {
    // 捕获幂等键
    let key: string | null = null;
    // 捕获请求体
    let body: unknown = null;
    server.use(
      http.post(/\/api\/v1\/admin\/courses$/, async ({ request }) => {
        key = request.headers.get('idempotency-key');
        body = await request.json();
        return HttpResponse.json(
          envelope({ id: 8, status: 'draft', version: 1 }),
          { status: 201 },
        );
      }),
    );

    const created = await createCourse(
      {
        name: '新课',
        type: 'video',
        originalCents: 1000,
        saleCents: 900,
        instructor: '王老师',
        coverUrl: 'image/demo/cover.png',
      },
      'key-12345678',
    );
    expect(key).toBe('key-12345678');
    expect(body).toMatchObject({ name: '新课', saleCents: 900 });
    expect(created.id).toBe(8);
  });

  it('编辑携带 version；409 抛 ApiError', async () => {
    // 捕获请求体
    let body: unknown = null;
    server.use(
      http.put(/\/api\/v1\/admin\/courses\/1$/, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            code: 4004,
            message: '数据已被修改，请刷新后重试',
            data: null,
            requestId: 'r-conflict',
          },
          { status: 409 },
        );
      }),
    );

    await expect(updateCourse(1, { version: 3, name: '新名' })).rejects.toMatchObject({
      status: 409,
      code: 4004,
    });
    expect(body).toEqual({ version: 3, name: '新名' });
  });

  it('发布、下架与详情路径正确，详情含 version', async () => {
    // 捕获访问过的 URL
    const urls: string[] = [];
    server.use(
      http.post(/\/api\/v1\/admin\/courses\/1\/publish$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope({ id: 1, status: 'published', version: 4 }));
      }),
      http.post(/\/api\/v1\/admin\/courses\/1\/unpublish$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope({ id: 1, status: 'unpublished', version: 5 }));
      }),
      http.get(/\/api\/v1\/admin\/courses\/1$/, () =>
        HttpResponse.json(
          envelope({
            id: 1,
            name: '课程',
            type: 'video',
            coverKey: null,
            coverUrl: null,
            instructor: null,
            originalCents: 1000,
            saleCents: 900,
            status: 'draft',
            version: 3,
            intro: null,
            detailRich: null,
            chapters: [],
            groupon: null,
            flashSale: null,
            claimableCoupons: [],
          }),
        ),
      ),
    );

    await publishCourse(1);
    await unpublishCourse(1);
    const detail = await getAdminCourse(1);
    expect(urls[0]).toMatch(/\/admin\/courses\/1\/publish$/);
    expect(urls[1]).toMatch(/\/admin\/courses\/1\/unpublish$/);
    expect(detail.version).toBe(3);
  });

  it('新增章节携带幂等键与类型；排序提交完整 id 列表', async () => {
    // 捕获新章请求体
    let chapterBody: unknown = null;
    // 捕获新章幂等键
    let chapterKey: string | null = null;
    // 捕获排序请求体
    let reorderBody: unknown = null;
    server.use(
      http.post(/\/api\/v1\/admin\/courses\/1\/chapters$/, async ({ request }) => {
        chapterBody = await request.json();
        chapterKey = request.headers.get('idempotency-key');
        return HttpResponse.json(
          envelope({ id: 2, title: '第一章', contentType: 'video', sortOrder: 1 }),
          { status: 201 },
        );
      }),
      http.post(/\/api\/v1\/admin\/courses\/1\/chapters\/reorder$/, async ({ request }) => {
        reorderBody = await request.json();
        return HttpResponse.json(envelope([]));
      }),
      http.delete(/\/api\/v1\/admin\/courses\/1\/chapters\/2$/, () =>
        HttpResponse.json(envelope(null)),
      ),
    );

    await addChapter(1, { title: '第一章', contentType: 'video' }, 'key-abcdefgh');
    await reorderChapters(1, [2, 1]);
    await deleteChapter(1, 2);

    expect(chapterKey).toBe('key-abcdefgh');
    expect(chapterBody).toEqual({ title: '第一章', contentType: 'video' });
    expect(reorderBody).toEqual({ orderedChapterIds: [2, 1] });
  });
});
