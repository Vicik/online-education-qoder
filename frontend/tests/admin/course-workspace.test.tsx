import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CourseWorkspacePage from '@/features/admin/courses/CourseWorkspacePage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-admin-workspace' };
}

// 课程详情桩
function courseDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'TypeScript 系统入门',
    type: 'video',
    coverKey: 'image/demo/cover.png',
    coverUrl: 'https://cdn.test/cover.png',
    instructor: '张老师',
    originalCents: 19900,
    saleCents: 9900,
    status: 'draft',
    version: 3,
    intro: '课程简介',
    detailRich: null,
    chapters: [
      { id: 1, title: '第一章', contentType: 'video', sortOrder: 1 },
      { id: 2, title: '第二章', contentType: 'video', sortOrder: 2 },
    ],
    groupon: null,
    flashSale: null,
    claimableCoupons: [],
    ...overrides,
  };
}

// 工作区路由
const routes = [
  { path: '/admin/courses', element: <div>course-list</div> },
  { path: '/admin/courses/:id', element: <CourseWorkspacePage /> },
];

// 详情接口地址
const detailUrl = /\/api\/v1\/admin\/courses\/1$/;
// 排序接口地址：避免与详情正则混淆
const reorderUrl = /\/api\/v1\/admin\/courses\/1\/chapters\/reorder$/;

describe('CourseWorkspacePage', () => {
  it('已发布课程只读并提示先下架', async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(envelope(courseDetail({ status: 'published' }))),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');

    expect(
      await screen.findByText('已发布课程不可编辑，请先下架'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('课程名称')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: '保存基本信息' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下架' })).toBeInTheDocument();
  });

  it('已下架课程仅开放讲师/封面/简介/详情与章节', async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(envelope(courseDetail({ status: 'unpublished' }))),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');

    expect(await screen.findByLabelText('课程名称')).toBeDisabled();
    expect(screen.getByLabelText('讲师')).toBeEnabled();
    expect(screen.getByRole('button', { name: '保存基本信息' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布' })).toBeInTheDocument();
  });

  it('已有章节时类型锁定并提示', async () => {
    server.use(
      http.get(detailUrl, () => HttpResponse.json(envelope(courseDetail()))),
    );

    renderWithProviders(routes, '/admin/courses/1');

    expect(await screen.findByLabelText('课程类型')).toBeDisabled();
    expect(
      screen.getByText('首个章节保存后课程类型不可修改'),
    ).toBeInTheDocument();
  });

  it('新增章节携带幂等键；上下移动提交排序', async () => {
    // 捕获新章请求体
    let chapterBody: Record<string, unknown> | null = null;
    // 捕获新章幂等键
    let chapterKey: string | null = null;
    // 捕获排序请求体
    let reorderBody: Record<string, unknown> | null = null;
    server.use(
      http.get(detailUrl, () => HttpResponse.json(envelope(courseDetail()))),
      http.post(/\/api\/v1\/admin\/courses\/1\/chapters$/, async ({ request }) => {
        chapterBody = (await request.json()) as Record<string, unknown>;
        chapterKey = request.headers.get('idempotency-key');
        return HttpResponse.json(
          envelope({ id: 3, title: '第三章', contentType: 'video', sortOrder: 3 }),
          { status: 201 },
        );
      }),
      http.post(reorderUrl, async ({ request }) => {
        reorderBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(envelope([]));
      }),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    await userEvent.click(screen.getByRole('button', { name: '新增章节' }));
    await userEvent.type(screen.getByLabelText('章节标题'), '第三章');
    await userEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() =>
      expect(chapterBody).toEqual({ title: '第三章', contentType: 'video' }),
    );
    expect(chapterKey).not.toBeNull();

    const firstRow = screen.getByText(/第一章/).closest('.ant-card') as HTMLElement;
    await userEvent.click(within(firstRow).getByRole('button', { name: '下移' }));
    await waitFor(() =>
      expect(reorderBody).toEqual({ orderedChapterIds: [2, 1] }),
    );
  });

  it('取消新增后再次打开，标题与正文为空', async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(envelope(courseDetail({ type: 'rich' }))),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    await userEvent.click(screen.getByRole('button', { name: '新增章节' }));

    await userEvent.type(screen.getByLabelText('章节标题'), '残留标题');
    const editor = document.querySelector('.ProseMirror') as HTMLElement;
    await userEvent.click(editor);
    await userEvent.keyboard('残留正文');
    expect(editor.textContent).toContain('残留正文');

    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    await userEvent.click(screen.getByRole('button', { name: '新增章节' }));

    expect(await screen.findByLabelText('章节标题')).toHaveValue('');
    expect((document.querySelector('.ProseMirror') as HTMLElement).textContent).toBe('');
  }, 30_000);

  it('编辑章节后打开新增，标题为空', async () => {
    server.use(
      http.get(detailUrl, () => HttpResponse.json(envelope(courseDetail()))),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    await userEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    expect(await screen.findByLabelText('章节标题')).toHaveValue('第一章');

    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    await userEvent.click(screen.getByRole('button', { name: '新增章节' }));

    expect(await screen.findByLabelText('章节标题')).toHaveValue('');
  }, 30_000);

  it('发布需二次确认，确认后刷新详情', async () => {
    // 详情请求次数
    let detailCalls = 0;
    // 是否发布
    let published = false;
    server.use(
      http.get(detailUrl, () => {
        detailCalls += 1;
        return HttpResponse.json(
          envelope(courseDetail({ status: published ? 'published' : 'draft' })),
        );
      }),
      http.post(/\/api\/v1\/admin\/courses\/1\/publish$/, () => {
        published = true;
        return HttpResponse.json(envelope({ id: 1, status: 'published', version: 4 }));
      }),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByRole('button', { name: '发布' }));
    expect(await screen.findByText('发布后课程对用户可见，确认发布？')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => expect(published).toBe(true));
    await waitFor(() => expect(detailCalls).toBeGreaterThanOrEqual(2));
  });

  it('保存遇到 409 时提示刷新，刷新重取详情', async () => {
    // 详情请求次数
    let detailCalls = 0;
    server.use(
      http.get(detailUrl, () => {
        detailCalls += 1;
        // 刷新后返回新的 version，表单按 key 重建并回显服务端值
        return HttpResponse.json(
          envelope(detailCalls === 1 ? courseDetail() : courseDetail({ version: 4 })),
        );
      }),
      http.put(/\/api\/v1\/admin\/courses\/1$/, () =>
        HttpResponse.json(
          {
            code: 4004,
            message: '数据已被修改，请刷新后重试',
            data: null,
            requestId: 'r-conflict',
          },
          { status: 409 },
        ),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');
    const nameInput = await screen.findByLabelText('课程名称');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, '改过的名称');
    await userEvent.click(screen.getByRole('button', { name: '保存基本信息' }));
    await userEvent.click(await screen.findByRole('button', { name: '保存' }));

    expect(
      await screen.findByText('内容已在其他页面被修改，请刷新后重试'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => expect(detailCalls).toBeGreaterThanOrEqual(2));
    expect(await screen.findByDisplayValue('TypeScript 系统入门')).toBeInTheDocument();
    // 富文本编辑器在 jsdom 中挂载/重挂载较慢，单独放宽本用例超时
  }, 60_000);
});
