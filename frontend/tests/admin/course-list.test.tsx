import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CourseListPage from '@/features/admin/courses/CourseListPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-admin-list' };
}

// 课程列表行桩
const row = {
  id: 1,
  name: 'TypeScript 系统入门',
  type: 'video',
  coverKey: null,
  coverUrl: null,
  instructor: '张老师',
  originalCents: 19900,
  saleCents: 9900,
  status: 'draft',
  isRecommended: false,
  isPromoted: false,
  promotionOrder: 0,
  chapterCount: 2,
  enrollmentCount: 3,
};

// 宣传位列表项工厂（排序条消费 id 与 name）
function promoted(id: number, name: string) {
  return { ...row, id, name, status: 'published', isPromoted: true };
}

// 课程列表接口桩：单条已发布课程
function mockList(items: Record<string, unknown>[]) {
  server.use(
    http.get(/\/api\/v1\/admin\/courses$/, () =>
      HttpResponse.json(
        envelope({ items, total: items.length, page: 1, pageSize: 10 }),
      ),
    ),
  );
}

describe('CourseListPage', () => {
  it('展示课程列并链接工作区', async () => {
    server.use(
      http.get(/\/api\/v1\/admin\/courses$/, () =>
        HttpResponse.json(envelope({ items: [row], total: 1, page: 1, pageSize: 10 })),
      ),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    expect(await screen.findByText('TypeScript 系统入门')).toBeInTheDocument();
    expect(screen.getByText('张老师')).toBeInTheDocument();
    expect(screen.getByText('¥99.00')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '管理' })).toHaveAttribute(
      'href',
      '/admin/courses/1',
    );
    // 预览：点击后在新标签页打开用户端详情页的预览模式
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await userEvent.click(screen.getByRole('button', { name: '预览' }));
    expect(openSpy).toHaveBeenCalledWith(
      '/admin/courses/1/preview',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });

  it('仅已发布课程显示推荐与取消推荐', async () => {
    server.use(
      http.get(/\/api\/v1\/admin\/courses$/, () =>
        HttpResponse.json(
          envelope({
            items: [
              { ...row, id: 1, name: '草稿课', status: 'draft' },
              { ...row, id: 2, name: '下架课', status: 'unpublished' },
              {
                ...row,
                id: 3,
                name: '已发布课',
                status: 'published',
                isRecommended: false,
              },
              {
                ...row,
                id: 4,
                name: '已推荐课',
                status: 'published',
                isRecommended: true,
              },
            ],
            total: 4,
            page: 1,
            pageSize: 10,
          }),
        ),
      ),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    // 草稿：只能发布，没有推荐入口
    const draftRow = (await screen.findByText('草稿课')).closest('tr') as HTMLElement;
    expect(within(draftRow).getByRole('button', { name: '发布' })).toBeInTheDocument();
    expect(
      within(draftRow).queryByRole('button', { name: '推荐' }),
    ).not.toBeInTheDocument();
    expect(
      within(draftRow).queryByRole('button', { name: '取消推荐' }),
    ).not.toBeInTheDocument();

    // 已下架：只能重新发布，没有推荐入口
    const unpublishedRow = (await screen.findByText('下架课')).closest(
      'tr',
    ) as HTMLElement;
    expect(
      within(unpublishedRow).getByRole('button', { name: '发布' }),
    ).toBeInTheDocument();
    expect(
      within(unpublishedRow).queryByRole('button', { name: '推荐' }),
    ).not.toBeInTheDocument();
    expect(
      within(unpublishedRow).queryByRole('button', { name: '取消推荐' }),
    ).not.toBeInTheDocument();

    // 已发布未推荐：可下架、可推荐
    const publishedRow = (await screen.findByText('已发布课')).closest(
      'tr',
    ) as HTMLElement;
    expect(
      within(publishedRow).getByRole('button', { name: '下架' }),
    ).toBeInTheDocument();
    expect(
      within(publishedRow).getByRole('button', { name: '推荐' }),
    ).toBeInTheDocument();

    // 已发布已推荐：可取消推荐
    const recommendedRow = (await screen.findByText('已推荐课')).closest(
      'tr',
    ) as HTMLElement;
    expect(
      within(recommendedRow).getByRole('button', { name: '取消推荐' }),
    ).toBeInTheDocument();
    expect(
      within(recommendedRow).queryByRole('button', { name: '推荐' }),
    ).not.toBeInTheDocument();
  });

  it('已下架课程有章节时可重新发布', async () => {
    // 发布请求次数
    let publishCalls = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/courses$/, () =>
        HttpResponse.json(
          envelope({
            items: [{ ...row, status: 'unpublished', chapterCount: 2 }],
            total: 1,
            page: 1,
            pageSize: 10,
          }),
        ),
      ),
      http.post(/\/api\/v1\/admin\/courses\/1\/publish$/, () => {
        publishCalls += 1;
        return HttpResponse.json(envelope({ id: 1, status: 'published', version: 3 }));
      }),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    await userEvent.click(await screen.findByRole('button', { name: '发布' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(publishCalls).toBe(1));
  });

  it('无章节课程发布按钮禁用并提示', async () => {
    server.use(
      http.get(/\/api\/v1\/admin\/courses$/, () =>
        HttpResponse.json(
          envelope({
            items: [{ ...row, name: '无章节课', chapterCount: 0 }],
            total: 1,
            page: 1,
            pageSize: 10,
          }),
        ),
      ),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    const draftRow = (await screen.findByText('无章节课')).closest('tr') as HTMLElement;
    // 发布按钮禁用，悬浮提示先添加章节
    const publishButton = within(draftRow).getByRole('button', { name: '发布' });
    expect(publishButton).toBeDisabled();
    await userEvent.hover(publishButton.parentElement as HTMLElement);
    expect(
      await screen.findByText('请先添加至少一个章节，再发布课程'),
    ).toBeInTheDocument();
  });

  it('状态筛选重新请求；空结果显示空态', async () => {
    // 捕获状态参数
    let status = '';
    server.use(
      http.get(/\/api\/v1\/admin\/courses$/, ({ request }) => {
        status = new URL(request.url).searchParams.get('status') ?? '';
        return HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 10 }));
      }),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    await userEvent.click(await screen.findByRole('combobox', { name: '状态筛选' }));
    await userEvent.click(await screen.findByText('已发布'));

    await waitFor(() => expect(status).toBe('published'));
    expect(await screen.findByText('还没有课程')).toBeInTheDocument();
  });

  it('草稿课程确认后发布并刷新列表', async () => {
    // 列表请求次数
    let listCalls = 0;
    // 发布请求次数
    let publishCalls = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/courses$/, () => {
        listCalls += 1;
        return HttpResponse.json(envelope({ items: [row], total: 1, page: 1, pageSize: 10 }));
      }),
      http.post(/\/api\/v1\/admin\/courses\/1\/publish$/, () => {
        publishCalls += 1;
        return HttpResponse.json(envelope({ id: 1, status: 'published', version: 2 }));
      }),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    await userEvent.click(await screen.findByRole('button', { name: '发布' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(publishCalls).toBe(1));
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
  });

  it('已发布课程确认后下架并刷新列表', async () => {
    // 列表请求次数
    let listCalls = 0;
    // 下架请求次数
    let unpublishCalls = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/courses$/, () => {
        listCalls += 1;
        return HttpResponse.json(
          envelope({
            items: [{ ...row, status: 'published' }],
            total: 1,
            page: 1,
            pageSize: 10,
          }),
        );
      }),
      http.post(/\/api\/v1\/admin\/courses\/1\/unpublish$/, () => {
        unpublishCalls += 1;
        return HttpResponse.json(envelope({ id: 1, status: 'unpublished', version: 3 }));
      }),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    await userEvent.click(await screen.findByRole('button', { name: '下架' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(unpublishCalls).toBe(1));
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
  });

  it('未推荐课程可设为推荐，成功后刷新列表', async () => {
    // 列表请求次数
    let listCalls = 0;
    // 推荐请求次数
    let recommendCalls = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/courses$/, () => {
        listCalls += 1;
        return HttpResponse.json(
          envelope({
            items: [{ ...row, status: 'published', isRecommended: false }],
            total: 1,
            page: 1,
            pageSize: 10,
          }),
        );
      }),
      http.post(/\/api\/v1\/admin\/courses\/1\/recommend$/, () => {
        recommendCalls += 1;
        return HttpResponse.json(envelope({ id: 1, isRecommended: true }));
      }),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    await userEvent.click(await screen.findByRole('button', { name: '推荐' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(recommendCalls).toBe(1));
    await waitFor(() => expect(listCalls).toBeGreaterThan(1));
  });

  it('已推荐课程可取消推荐', async () => {
    // 取消推荐请求次数
    let unrecommendCalls = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/courses$/, () =>
        HttpResponse.json(
          envelope({
            items: [{ ...row, status: 'published', isRecommended: true }],
            total: 1,
            page: 1,
            pageSize: 10,
          }),
        ),
      ),
      http.post(/\/api\/v1\/admin\/courses\/1\/unrecommend$/, () => {
        unrecommendCalls += 1;
        return HttpResponse.json(envelope({ id: 1, isRecommended: false }));
      }),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    await userEvent.click(await screen.findByRole('button', { name: '取消推荐' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(unrecommendCalls).toBe(1));
  });

  it('已发布未宣传的课程可设为宣传', async () => {
    // 设为宣传请求次数
    let promoteCalls = 0;
    mockList([{ ...row, status: 'published', isPromoted: false }]);
    server.use(
      http.post(/\/api\/v1\/admin\/courses\/1\/promote$/, () => {
        promoteCalls += 1;
        return HttpResponse.json(
          envelope({ id: 1, status: 'published', isPromoted: true, promotionOrder: 1 }),
        );
      }),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    await userEvent.click(await screen.findByRole('button', { name: '宣传' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(promoteCalls).toBe(1));
  });

  it('已宣传的课程显示取消宣传并调用接口', async () => {
    // 取消宣传请求次数
    let unpromoteCalls = 0;
    mockList([{ ...row, status: 'published', isPromoted: true, promotionOrder: 1 }]);
    server.use(
      http.post(/\/api\/v1\/admin\/courses\/1\/unpromote$/, () => {
        unpromoteCalls += 1;
        return HttpResponse.json(
          envelope({ id: 1, status: 'published', isPromoted: false, promotionOrder: 0 }),
        );
      }),
    );

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    expect(
      screen.queryByRole('button', { name: '宣传' }),
    ).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '取消宣传' }));
    await userEvent.click(await screen.findByRole('button', { name: '确定' }));

    await waitFor(() => expect(unpromoteCalls).toBe(1));
  });

  it('草稿课程没有宣传入口', async () => {
    mockList([{ ...row, status: 'draft' }]);

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    const draftRow = (await screen.findByText(row.name)).closest(
      'tr',
    ) as HTMLElement;
    expect(
      within(draftRow).queryByRole('button', { name: '宣传' }),
    ).not.toBeInTheDocument();
  });

  it('宣传位满 5 门时宣传按钮禁用并提示原因', async () => {
    server.use(
      http.get(/\/api\/v1\/admin\/courses\/promotion$/, () =>
        HttpResponse.json(
          envelope(
            [1, 2, 3, 4, 5].map((id) => promoted(id, `宣传课${id}`)),
          ),
        ),
      ),
    );
    mockList([{ ...row, id: 9, name: '待宣传课', status: 'published', isPromoted: false }]);

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    const targetRow = (await screen.findByText('待宣传课')).closest(
      'tr',
    ) as HTMLElement;
    const promoteButton = within(targetRow).getByRole('button', { name: '宣传' });
    expect(promoteButton).toBeDisabled();
    await userEvent.hover(promoteButton.parentElement as HTMLElement);
    expect(
      await screen.findByText('首页宣传位最多 5 门课程，请先取消其他课程的宣传'),
    ).toBeInTheDocument();
  });

  it('排序条按上下移动提交完整宣传课程顺序', async () => {
    // 排序请求次数与最后一次请求体
    let reorderCalls = 0;
    // 最近一次排序请求体
    let lastPayload: { courseIds?: number[] } = {};
    // 服务端视角的宣传顺序，随排序请求变化
    let orderIds = [1, 2];
    // 课程 id 对应的中文序号名，便于断言按钮可访问名
    const nameById: Record<number, string> = { 1: '宣传课一', 2: '宣传课二' };
    server.use(
      http.get(/\/api\/v1\/admin\/courses\/promotion$/, () =>
        HttpResponse.json(
          envelope(orderIds.map((id) => promoted(id, nameById[id]))),
        ),
      ),
      http.post(/\/api\/v1\/admin\/courses\/promotion\/reorder$/, async ({ request }) => {
        reorderCalls += 1;
        lastPayload = (await request.json()) as { courseIds?: number[] };
        orderIds = lastPayload.courseIds ?? orderIds;
        return HttpResponse.json(envelope([]));
      }),
    );
    mockList([{ ...row, id: 1, status: 'published', isPromoted: true, promotionOrder: 1 }]);

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    // 首位不能上移，末位才能上移
    expect(
      await screen.findByRole('button', { name: '上移《宣传课一》' }),
    ).toBeDisabled();
    await userEvent.click(
      await screen.findByRole('button', { name: '上移《宣传课二》' }),
    );
    await waitFor(() => expect(reorderCalls).toBe(1));
    expect(lastPayload.courseIds).toEqual([2, 1]);

    // 刷新后课二排首位：上移禁用，可下移回到原顺序
    expect(
      await screen.findByRole('button', { name: '上移《宣传课二》' }),
    ).toBeDisabled();
    await userEvent.click(
      await screen.findByRole('button', { name: '下移《宣传课二》' }),
    );
    await waitFor(() => expect(reorderCalls).toBe(2));
    expect(lastPayload.courseIds).toEqual([1, 2]);
  });

  it('下架确认提示同时移出推荐位与宣传位', async () => {
    mockList([{ ...row, status: 'published', isRecommended: true, isPromoted: true }]);

    renderWithProviders(
      [{ path: '/admin/courses', element: <CourseListPage /> }],
      '/admin/courses',
    );

    await userEvent.click(await screen.findByRole('button', { name: '下架' }));
    expect(
      await screen.findByText(/同时移出首页推荐位与宣传位/),
    ).toBeInTheDocument();
  });
});
