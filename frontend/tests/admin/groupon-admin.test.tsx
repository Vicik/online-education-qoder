import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import GrouponListPage from '@/features/admin/groupons/GrouponListPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-groupon-admin' };
}

// 未开始活动桩
const draftActivity = {
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

// 进行中活动桩（不可编辑/取消）
const ongoingActivity = {
  ...draftActivity,
  id: 3,
  name: '进行中的团',
  status: 'ongoing',
};

// 已发布课程下拉桩
const coursesHandler = http.get(/\/api\/v1\/admin\/courses$/, () =>
  HttpResponse.json(
    envelope({
      items: [{ id: 2, name: 'TypeScript 系统入门' }],
      total: 1,
      page: 1,
      pageSize: 100,
    }),
  ),
);

// 活动列表桩
const listHandler = (items = [draftActivity, ongoingActivity]) =>
  http.get(/\/api\/v1\/admin\/groupons$/, () =>
    HttpResponse.json(
      envelope({ items, total: items.length, page: 1, pageSize: 10 }),
    ),
  );

// 点按钮：按文本定位后取最近的 button，避免 jsdom 中昂贵的可访问名计算
async function clickButton(label: string) {
  // 按钮内文本节点（antd 渲染为 span）
  const text = await screen.findByText(label);
  // 最近的可点击祖先
  const button = text.closest('button');
  if (!button) throw new Error(`未找到按钮：${label}`);
  fireEvent.click(button);
}

// 在 DatePicker 输入框键入时间并回车提交
function typeDateTime(placeholder: string, value: string) {
  // 目标输入框
  const input = screen.getByPlaceholderText(placeholder);
  fireEvent.mouseDown(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
  fireEvent.blur(input);
}

describe('GrouponListPage', () => {
  it('列表展示状态与价格，进行中活动禁用编辑与取消', async () => {
    server.use(coursesHandler, listHandler());

    renderWithProviders(
      [{ path: '/admin/groupons', element: <GrouponListPage /> }],
      '/admin/groupons',
    );

    expect(await screen.findByText('三人成团')).toBeInTheDocument();
    // 两条活动共用同一拼团价
    expect(screen.getAllByText('¥99.00')).toHaveLength(2);
    expect(screen.getByText('进行中的团')).toBeInTheDocument();

    // 目标行内的按钮状态
    const ongoingRow = screen.getByText('进行中的团').closest('tr')!;
    expect(within(ongoingRow).getByRole('button', { name: '编辑' })).toBeDisabled();
    expect(within(ongoingRow).getByRole('button', { name: '取消' })).toBeDisabled();

    // 未开始行可操作
    const draftRow = screen.getByText('三人成团').closest('tr')!;
    expect(within(draftRow).getByRole('button', { name: '编辑' })).toBeEnabled();
  });

  it(
    '创建活动：确认后提交完整载荷与幂等键',
    async () => {
      // 创建请求体
      let body: Record<string, unknown> | null = null;
      // 创建幂等键
      let key: string | null = null;
      server.use(
        coursesHandler,
        listHandler(),
        http.post(/\/api\/v1\/admin\/groupons$/, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          key = request.headers.get('idempotency-key');
          return HttpResponse.json(envelope(draftActivity), { status: 201 });
        }),
      );

      renderWithProviders(
        [{ path: '/admin/groupons', element: <GrouponListPage /> }],
        '/admin/groupons',
      );

      await clickButton('创建拼团');
      fireEvent.mouseDown(screen.getByRole('combobox', { name: '关联课程' }));
      fireEvent.click(await screen.findByTitle('TypeScript 系统入门'));
      fireEvent.change(screen.getByLabelText('活动名称'), {
        target: { value: '五人团' },
      });
      fireEvent.change(screen.getByPlaceholderText('拼团价（元）'), {
        target: { value: '88' },
      });
      fireEvent.change(screen.getByLabelText('成团人数'), { target: { value: '5' } });
      fireEvent.blur(screen.getByLabelText('成团人数'));
      typeDateTime('开始时间', '2026-11-20 10:00:00');
      typeDateTime('结束时间', '2026-11-27 10:00:00');

      await clickButton('创建');
      await clickButton('确认创建');

      await waitFor(() => expect(key).not.toBeNull(), { timeout: 10_000 });
      expect(body).toMatchObject({
        courseId: 2,
        name: '五人团',
        priceCents: 8800,
        targetSize: 5,
        startAt: '2026-11-20T02:00:00.000Z',
        endAt: '2026-11-27T02:00:00.000Z',
      });
    },
    60_000,
  );

  it(
    '编辑活动：回填并携带 version，不提交 courseId',
    async () => {
      // 编辑请求体
      let body: Record<string, unknown> | null = null;
      server.use(
        coursesHandler,
        listHandler(),
        http.put(/\/api\/v1\/admin\/groupons\/1$/, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(envelope({ ...draftActivity, version: 3 }));
        }),
      );

      renderWithProviders(
        [{ path: '/admin/groupons', element: <GrouponListPage /> }],
        '/admin/groupons',
      );

      const draftRow = (await screen.findByText('三人成团')).closest('tr')!;
      fireEvent.click(within(draftRow).getByRole('button', { name: '编辑' }));
      expect(screen.getByLabelText('活动名称')).toHaveValue('三人成团');

      fireEvent.change(screen.getByLabelText('活动名称'), {
        target: { value: '新名字' },
      });
      await clickButton('保存');
      await clickButton('确认保存');

      await waitFor(() => expect(body).not.toBeNull(), { timeout: 10_000 });
      expect(body).toMatchObject({ version: 2, name: '新名字' });
      expect(body).not.toHaveProperty('courseId');
    },
    60_000,
  );

  it('取消活动：二次确认后调用取消接口', async () => {
    // 取消访问的 URL
    let cancelUrl = '';
    server.use(
      coursesHandler,
      listHandler(),
      http.post(/\/api\/v1\/admin\/groupons\/1\/cancel$/, ({ request }) => {
        cancelUrl = request.url;
        return HttpResponse.json(
          envelope({ ...draftActivity, status: 'cancelled' }),
        );
      }),
    );

    renderWithProviders(
      [{ path: '/admin/groupons', element: <GrouponListPage /> }],
      '/admin/groupons',
    );

    const draftRow = (await screen.findByText('三人成团')).closest('tr')!;
    fireEvent.click(within(draftRow).getByRole('button', { name: '取消' }));
    await clickButton('确认取消');

    await waitFor(() =>
      expect(cancelUrl).toMatch(/\/admin\/groupons\/1\/cancel$/),
    );
  });

  it(
    '编辑遇 409：弹出刷新提示且不关闭确认框',
    async () => {
      server.use(
        coursesHandler,
        listHandler(),
        http.put(/\/api\/v1\/admin\/groupons\/1$/, () =>
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

      renderWithProviders(
        [{ path: '/admin/groupons', element: <GrouponListPage /> }],
        '/admin/groupons',
      );

      const draftRow = (await screen.findByText('三人成团')).closest('tr')!;
      fireEvent.click(within(draftRow).getByRole('button', { name: '编辑' }));
      await clickButton('保存');
      await clickButton('确认保存');

      expect(
        (await screen.findAllByText('内容已在其他页面被修改')).length,
      ).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    },
    60_000,
  );
});
