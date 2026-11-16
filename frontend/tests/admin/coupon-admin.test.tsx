import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import CouponListPage from '@/features/admin/coupons/CouponListPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-coupon-admin' };
}

// 停用模板桩
const disabledTemplate = {
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

// 启用模板桩（面额与名称一致）
const enabledTemplate = {
  ...disabledTemplate,
  id: 10,
  name: '满 200 减 50',
  discountCents: 5000,
  claimedCount: 5,
  status: 'enabled',
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

// 模板列表桩
const listHandler = () =>
  http.get(/\/api\/v1\/admin\/coupons$/, () =>
    HttpResponse.json(
      envelope({
        items: [disabledTemplate, enabledTemplate],
        total: 2,
        page: 1,
        pageSize: 10,
      }),
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

describe('CouponListPage', () => {
  it('按状态筛选并展示面额与已领数量', async () => {
    // 列表查询参数
    let query = new URLSearchParams();
    server.use(
      coursesHandler,
      http.get(/\/api\/v1\/admin\/coupons$/, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(
          envelope({
            items: [enabledTemplate],
            total: 1,
            page: 1,
            pageSize: 10,
          }),
        );
      }),
    );

    renderWithProviders(
      [{ path: '/admin/coupons', element: <CouponListPage /> }],
      '/admin/coupons',
    );

    expect(await screen.findByText('满 200 减 50')).toBeInTheDocument();
    expect(screen.getByText('¥50.00')).toBeInTheDocument();
    expect(screen.getByText('5 / 100')).toBeInTheDocument();

    // 切换为「已启用」筛选
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '状态筛选' }));
    fireEvent.click(await screen.findByTitle('已启用'));

    await waitFor(() => expect(query.get('status')).toBe('enabled'));
  });

  it(
    '创建模板：默认不启用、适用课程多选、幂等键',
    async () => {
      // 创建请求体
      let body: Record<string, unknown> | null = null;
      // 创建幂等键
      let key: string | null = null;
      server.use(
        coursesHandler,
        listHandler(),
        http.post(/\/api\/v1\/admin\/coupons$/, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          key = request.headers.get('idempotency-key');
          return HttpResponse.json(envelope(disabledTemplate), { status: 201 });
        }),
      );

      renderWithProviders(
        [{ path: '/admin/coupons', element: <CouponListPage /> }],
        '/admin/coupons',
      );

      await clickButton('创建优惠券');
      fireEvent.change(screen.getByLabelText('券名称'), {
        target: { value: '满 100 减 20' },
      });
      fireEvent.change(screen.getByPlaceholderText('面额（元）'), {
        target: { value: '20' },
      });
      fireEvent.change(screen.getByLabelText('发放总量'), {
        target: { value: '100' },
      });
      fireEvent.blur(screen.getByLabelText('发放总量'));
      typeDateTime('开始时间', '2026-11-20 08:00:00');
      typeDateTime('结束时间', '2026-12-20 08:00:00');

      // 选择适用课程
      fireEvent.mouseDown(screen.getByRole('combobox', { name: '适用课程' }));
      fireEvent.click(await screen.findByTitle('TypeScript 系统入门'));

      await clickButton('创建');
      await clickButton('确认创建');

      await waitFor(() => expect(key).not.toBeNull(), { timeout: 10_000 });
      expect(body).toMatchObject({
        name: '满 100 减 20',
        discountCents: 2000,
        totalQty: 100,
        perUserLimit: 1,
        courseIds: [2],
        enableOnCreate: false,
        startAt: '2026-11-20T00:00:00.000Z',
        endAt: '2026-12-20T00:00:00.000Z',
      });
    },
    60_000,
  );

  it('停用启用中的模板：确认框提示未使用券永久失效', async () => {
    // 停用访问的 URL
    let disableUrl = '';
    server.use(
      coursesHandler,
      listHandler(),
      http.post(/\/api\/v1\/admin\/coupons\/10\/disable$/, ({ request }) => {
        disableUrl = request.url;
        return HttpResponse.json(
          envelope({ ...enabledTemplate, status: 'disabled' }),
        );
      }),
    );

    renderWithProviders(
      [{ path: '/admin/coupons', element: <CouponListPage /> }],
      '/admin/coupons',
    );

    const row = (await screen.findByText('满 200 减 50')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: '停用' }));

    expect(
      await screen.findByText(/未使用和已恢复的优惠券将永久失效/),
    ).toBeInTheDocument();
    await clickButton('确认停用');

    await waitFor(() =>
      expect(disableUrl).toMatch(/\/admin\/coupons\/10\/disable$/),
    );
  });

  it(
    '点编辑打开弹窗：详情回填表单字段',
    async () => {
      server.use(
        coursesHandler,
        listHandler(),
        http.get(/\/api\/v1\/admin\/coupons\/9$/, () =>
          HttpResponse.json(envelope(disabledTemplate)),
        ),
      );

      renderWithProviders(
        [{ path: '/admin/coupons', element: <CouponListPage /> }],
        '/admin/coupons',
      );

      const row = (await screen.findByText('满 100 减 20')).closest('tr')!;
      fireEvent.click(within(row).getByRole('button', { name: '编辑' }));

      expect(await screen.findByText('编辑优惠券')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByLabelText('券名称')).toHaveValue('满 100 减 20'),
      );
      expect(screen.getByLabelText('发放总量')).toHaveValue('100');
      // InputNumber 按 precision 格式化，接受 20 与 20.00 两种渲染
      expect(
        (screen.getByPlaceholderText('面额（元）') as HTMLInputElement).value,
      ).toMatch(/^20(\.00)?$/);
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    },
    60_000,
  );

  it(
    '编辑保存：携带详情 version，成功后刷新列表',
    async () => {
      // 编辑请求体
      let body: Record<string, unknown> | null = null;
      server.use(
        coursesHandler,
        listHandler(),
        http.get(/\/api\/v1\/admin\/coupons\/9$/, () =>
          HttpResponse.json(envelope(disabledTemplate)),
        ),
        http.put(/\/api\/v1\/admin\/coupons\/9$/, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            envelope({ ...disabledTemplate, name: '改名券', version: 4 }),
          );
        }),
      );

      renderWithProviders(
        [{ path: '/admin/coupons', element: <CouponListPage /> }],
        '/admin/coupons',
      );

      const row = (await screen.findByText('满 100 减 20')).closest('tr')!;
      fireEvent.click(within(row).getByRole('button', { name: '编辑' }));

      const nameInput = await screen.findByLabelText('券名称');
      await waitFor(() => expect(nameInput).toHaveValue('满 100 减 20'));
      fireEvent.change(nameInput, { target: { value: '改名券' } });
      await clickButton('保存');
      await clickButton('确认保存');

      await waitFor(() => expect(body).not.toBeNull(), { timeout: 10_000 });
      expect(body).toMatchObject({ version: 3, name: '改名券' });
      expect(await screen.findByText('优惠券模板已保存')).toBeInTheDocument();
    },
    60_000,
  );

  it(
    '启用态编辑：弹窗只读并提示先停用',
    async () => {
      server.use(
        coursesHandler,
        listHandler(),
        http.get(/\/api\/v1\/admin\/coupons\/10$/, () =>
          HttpResponse.json(envelope(enabledTemplate)),
        ),
      );

      renderWithProviders(
        [{ path: '/admin/coupons', element: <CouponListPage /> }],
        '/admin/coupons',
      );

      const row = (await screen.findByText('满 200 减 50')).closest('tr')!;
      fireEvent.click(within(row).getByRole('button', { name: '编辑' }));

      expect(
        await screen.findByText('模板已启用，请先停用后再编辑'),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByLabelText('券名称')).toBeDisabled(),
      );
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    },
    60_000,
  );

  it(
    '编辑保存遇 409：弹出刷新提示，点刷新重取详情',
    async () => {
      // 详情请求次数
      let detailCount = 0;
      // 当前详情版本（刷新后变 4）
      let currentVersion = 3;
      server.use(
        coursesHandler,
        listHandler(),
        http.get(/\/api\/v1\/admin\/coupons\/9$/, () => {
          detailCount += 1;
          return HttpResponse.json(
            envelope({ ...disabledTemplate, version: currentVersion }),
          );
        }),
        http.put(/\/api\/v1\/admin\/coupons\/9$/, () => {
          currentVersion = 4;
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

      renderWithProviders(
        [{ path: '/admin/coupons', element: <CouponListPage /> }],
        '/admin/coupons',
      );

      const row = (await screen.findByText('满 100 减 20')).closest('tr')!;
      fireEvent.click(within(row).getByRole('button', { name: '编辑' }));
      await waitFor(() =>
        expect(screen.getByLabelText('券名称')).toHaveValue('满 100 减 20'),
      );
      await clickButton('保存');
      await clickButton('确认保存');

      expect(
        (await screen.findAllByText('内容已在其他页面被修改')).length,
      ).toBeGreaterThan(0);
      expect(detailCount).toBe(1);
      await clickButton('刷新');
      await waitFor(() => expect(detailCount).toBe(2), { timeout: 10_000 });
    },
    60_000,
  );

  it('启用模板：二次确认后调用启用接口', async () => {
    // 启用访问的 URL
    let enableUrl = '';
    server.use(
      coursesHandler,
      listHandler(),
      http.post(/\/api\/v1\/admin\/coupons\/9\/enable$/, ({ request }) => {
        enableUrl = request.url;
        return HttpResponse.json(
          envelope({ ...disabledTemplate, status: 'enabled' }),
        );
      }),
    );

    renderWithProviders(
      [{ path: '/admin/coupons', element: <CouponListPage /> }],
      '/admin/coupons',
    );

    const row = (await screen.findByText('满 100 减 20')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: '启用' }));
    await clickButton('确认启用');

    await waitFor(() =>
      expect(enableUrl).toMatch(/\/admin\/coupons\/9\/enable$/),
    );
  });
});
