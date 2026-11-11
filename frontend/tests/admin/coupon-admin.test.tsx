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
