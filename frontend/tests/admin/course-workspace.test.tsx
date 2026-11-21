import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CourseWorkspacePage from '@/features/admin/courses/CourseWorkspacePage';
import { probeVideoDecodable } from '@/lib/media-probe';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 视频探测：jsdom 无媒体解码能力，统一桩为可解码
vi.mock('@/lib/media-probe', () => ({
  probeVideoDecodable: vi.fn(),
}));

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
      { id: 1, title: '第一章', contentType: 'video', sortOrder: 1, content: 'video/2026/11/12/keep.mp4', isFree: false },
      { id: 2, title: '第二章', contentType: 'video', sortOrder: 2, content: 'video/2026/11/12/keep2.mp4', isFree: false },
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

describe('CourseWorkspacePage', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.mocked(probeVideoDecodable).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.mocked(probeVideoDecodable).mockReset();
  });

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
      http.post(/\/api\/v1\/admin\/files\/video$/, () =>
        HttpResponse.json(
          envelope({
            key: 'video/2026/11/12/new.mp4',
            url: 'https://cdn.test/new.mp4',
            mimeType: 'video/mp4',
            size: 4,
          }),
          { status: 201 },
        ),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    await userEvent.click(screen.getByRole('button', { name: '新增章节' }));
    await userEvent.type(screen.getByLabelText('章节标题'), '第三章');
    // 正文必填：先上传视频写入 key
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['video'], 'new.mp4', { type: 'video/mp4' }));
    await screen.findByRole('button', { name: '更换视频' });
    await userEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() =>
      expect(chapterBody).toEqual({
        title: '第三章',
        contentType: 'video',
        content: 'video/2026/11/12/new.mp4',
        isFree: false,
      }),
    );
    expect(chapterKey).not.toBeNull();

    const firstRow = screen.getByText(/第一章/).closest('.ant-card') as HTMLElement;
    await userEvent.click(within(firstRow).getByRole('button', { name: '下移' }));
    await waitFor(() =>
      expect(reorderBody).toEqual({ orderedChapterIds: [2, 1] }),
    );
  }, 60_000);

  it('新增章节未上传正文时提示必填且不提交', async () => {
    // 记录新增接口是否被调用
    let called = false;
    server.use(
      http.get(detailUrl, () => HttpResponse.json(envelope(courseDetail()))),
      http.post(/\/api\/v1\/admin\/courses\/1\/chapters$/, () => {
        called = true;
        return HttpResponse.json(envelope({ id: 3 }), { status: 201 });
      }),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    await userEvent.click(screen.getByRole('button', { name: '新增章节' }));
    await userEvent.type(screen.getByLabelText('章节标题'), '未上传正文');
    await userEvent.click(screen.getByRole('button', { name: '确定' }));

    expect(
      await screen.findByText('请上传章节正文（视频/音频）'),
    ).toBeInTheDocument();
    expect(called).toBe(false);
  }, 60_000);

  it('编辑章节回填原正文，只改标题时原样提交', async () => {
    // 捕获编辑请求体
    let updateBody: Record<string, unknown> | null = null;
    server.use(
      http.get(detailUrl, () => HttpResponse.json(envelope(courseDetail()))),
      http.put(/\/api\/v1\/admin\/courses\/1\/chapters\/1$/, async ({ request }) => {
        updateBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          envelope({ id: 1, title: '第一章改名', contentType: 'video', sortOrder: 1 }),
        );
      }),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    await userEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);

    // 正文回填为已保存的媒体 key，无需重新上传
    expect(
      await screen.findByText('已选择视频；编辑模式不加载旧媒体预览'),
    ).toBeInTheDocument();
    const titleInput = await screen.findByLabelText('章节标题');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, '第一章改名');
    await userEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() =>
      expect(updateBody).toEqual({
        title: '第一章改名',
        content: 'video/2026/11/12/keep.mp4',
        isFree: false,
      }),
    );
  }, 60_000);

  it('新增章节可勾选免费试看并提交 isFree', async () => {
    let chapterBody: Record<string, unknown> | null = null;
    server.use(
      http.get(detailUrl, () => HttpResponse.json(envelope(courseDetail()))),
      http.post(/\/api\/v1\/admin\/courses\/1\/chapters$/, async ({ request }) => {
        chapterBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          envelope({ id: 3, title: '试看章节', contentType: 'video', sortOrder: 3, isFree: true }),
          { status: 201 },
        );
      }),
      http.post(/\/api\/v1\/admin\/files\/video$/, () =>
        HttpResponse.json(
          envelope({
            key: 'video/2026/11/12/trial.mp4',
            url: 'https://cdn.test/trial.mp4',
            mimeType: 'video/mp4',
            size: 4,
          }),
          { status: 201 },
        ),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    await userEvent.click(screen.getByRole('button', { name: '新增章节' }));
    await userEvent.type(screen.getByLabelText('章节标题'), '试看章节');
    await userEvent.click(screen.getByRole('switch', { name: '免费试看' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['video'], 'trial.mp4', { type: 'video/mp4' }));
    await screen.findByRole('button', { name: '更换视频' });
    await userEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => expect(chapterBody).toMatchObject({ isFree: true }));
  }, 60_000);

  it('编辑章节回填免费试看开关', async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          envelope(
            courseDetail({
              chapters: [
                {
                  id: 1,
                  title: '第一章',
                  contentType: 'video',
                  sortOrder: 1,
                  content: 'video/2026/11/12/keep.mp4',
                  isFree: true,
                },
              ],
            }),
          ),
        ),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    expect(await screen.findByText('试看')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    expect(await screen.findByRole('switch', { name: '免费试看' })).toBeChecked();
  }, 60_000);

  it('免费课程展示章节与售价提示', async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(envelope(courseDetail({ saleCents: 0 }))),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');

    expect(
      await screen.findByText('免费课程：全部章节公开，不可参与拼团/秒杀/优惠券'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText('章节维护'));
    expect(
      await screen.findByText('免费课程：全部章节对所有人开放，试看标记不影响权限'),
    ).toBeInTheDocument();
  }, 60_000);

  it('取消新增后再次打开，标题与媒体为空', async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(envelope(courseDetail({ type: 'audio' }))),
      ),
      http.post(/\/api\/v1\/admin\/files\/audio$/, () =>
        HttpResponse.json(
          envelope({
            key: 'audios/2026/11/a.mp3',
            url: 'https://cdn.test/a.mp3',
            mimeType: 'audio/mpeg',
            size: 10,
          }),
          { status: 201 },
        ),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    await userEvent.click(screen.getByRole('button', { name: '新增章节' }));

    await userEvent.type(screen.getByLabelText('章节标题'), '残留标题');
    // 隐藏文件输入：上传一个音频，表单正文被写入 key
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['audio'], 'a.mp3', { type: 'audio/mpeg' }));
    expect(await screen.findByRole('button', { name: '更换音频' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    await userEvent.click(screen.getByRole('button', { name: '新增章节' }));

    expect(await screen.findByLabelText('章节标题')).toHaveValue('');
    expect(screen.getByText('尚未上传音频')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更换音频' })).not.toBeInTheDocument();
  }, 60_000);

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
  }, 60_000);

  it('无章节时发布按钮禁用并提示', async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          envelope(courseDetail({ chapters: [], chapterCount: 0 })),
        ),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');

    // 发布按钮禁用，悬浮提示先添加章节
    const publishButton = await screen.findByRole('button', { name: '发布' });
    expect(publishButton).toBeDisabled();
    await userEvent.hover(publishButton.parentElement as HTMLElement);
    expect(
      await screen.findByText('请先添加至少一个章节，再发布课程'),
    ).toBeInTheDocument();
  }, 60_000);

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
