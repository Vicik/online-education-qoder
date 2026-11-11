import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import FlashSaleListPage from '@/features/admin/flash-sales/FlashSaleListPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-flash-admin' };
}

// 未开始活动桩：已售 3，总库存 50
const draftSale = {
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

// 进行中活动桩（不可编辑/取消）
const ongoingSale = { ...draftSale, id: 6, name: '进行中秒杀', status: 'ongoing' };

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
const listHandler = () =>
  http.get(/\/api\/v1\/admin\/flash-sales$/, () =>
    HttpResponse.json(
      envelope({
        items: [draftSale, ongoingSale],
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

describe('FlashSaleListPage', () => {
  it('列表展示库存与状态，进行中活动禁用操作', async () => {
    server.use(coursesHandler, listHandler());

    renderWithProviders(
      [{ path: '/admin/flash-sales', element: <FlashSaleListPage /> }],
      '/admin/flash-sales',
    );

    expect(await screen.findByText('限时秒杀')).toBeInTheDocument();

    // 两个活动桩库存/已售相同，需限定到目标行
    const draftRow = screen.getByText('限时秒杀').closest('tr')!;
    expect(within(draftRow).getByText('50')).toBeInTheDocument();
    expect(within(draftRow).getByText('3')).toBeInTheDocument();

    // 目标行内的按钮状态
    const ongoingRow = screen.getByText('进行中秒杀').closest('tr')!;
    expect(within(ongoingRow).getByRole('button', { name: '编辑' })).toBeDisabled();
    expect(within(ongoingRow).getByRole('button', { name: '取消' })).toBeDisabled();
  });

  it(
    '创建秒杀：确认后提交库存与幂等键',
    async () => {
      // 创建请求体
      let body: Record<string, unknown> | null = null;
      // 创建幂等键
      let key: string | null = null;
      server.use(
        coursesHandler,
        listHandler(),
        http.post(/\/api\/v1\/admin\/flash-sales$/, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          key = request.headers.get('idempotency-key');
          return HttpResponse.json(envelope(draftSale), { status: 201 });
        }),
      );

      renderWithProviders(
        [{ path: '/admin/flash-sales', element: <FlashSaleListPage /> }],
        '/admin/flash-sales',
      );

      await clickButton('创建秒杀');
      fireEvent.mouseDown(screen.getByRole('combobox', { name: '关联课程' }));
      fireEvent.click(await screen.findByTitle('TypeScript 系统入门'));
      fireEvent.change(screen.getByLabelText('活动名称'), {
        target: { value: '双十一秒杀' },
      });
      fireEvent.change(screen.getByPlaceholderText('秒杀价（元）'), {
        target: { value: '39' },
      });
      fireEvent.change(screen.getByLabelText('总库存'), { target: { value: '20' } });
      fireEvent.blur(screen.getByLabelText('总库存'));
      typeDateTime('开始时间', '2026-11-20 10:00:00');
      typeDateTime('结束时间', '2026-11-20 12:00:00');

      await clickButton('创建');
      await clickButton('确认创建');

      await waitFor(() => expect(key).not.toBeNull(), { timeout: 10_000 });
      expect(body).toMatchObject({
        courseId: 2,
        name: '双十一秒杀',
        priceCents: 3900,
        stock: 20,
        startAt: '2026-11-20T02:00:00.000Z',
        endAt: '2026-11-20T04:00:00.000Z',
      });
    },
    60_000,
  );

  it('编辑秒杀：库存小于已售时提示且不发请求', async () => {
    // 是否发出编辑请求
    let putCount = 0;
    server.use(
      coursesHandler,
      listHandler(),
      http.put(/\/api\/v1\/admin\/flash-sales\/5$/, () => {
        putCount += 1;
        return HttpResponse.json(envelope(draftSale));
      }),
    );

    renderWithProviders(
      [{ path: '/admin/flash-sales', element: <FlashSaleListPage /> }],
      '/admin/flash-sales',
    );

    const row = (await screen.findByText('限时秒杀')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('总库存'), { target: { value: '2' } });
    fireEvent.blur(screen.getByLabelText('总库存'));
    await clickButton('保存');

    expect(await screen.findByText('库存不得小于已售')).toBeInTheDocument();
    expect(putCount).toBe(0);
  });

  it(
    '编辑秒杀：保存携带 version 且不含 courseId',
    async () => {
      // 编辑请求体
      let body: Record<string, unknown> | null = null;
      server.use(
        coursesHandler,
        listHandler(),
        http.put(/\/api\/v1\/admin\/flash-sales\/5$/, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(envelope({ ...draftSale, version: 5 }));
        }),
      );

      renderWithProviders(
        [{ path: '/admin/flash-sales', element: <FlashSaleListPage /> }],
        '/admin/flash-sales',
      );

      const row = (await screen.findByText('限时秒杀')).closest('tr')!;
      fireEvent.click(within(row).getByRole('button', { name: '编辑' }));
      fireEvent.change(screen.getByLabelText('活动名称'), {
        target: { value: '改名秒杀' },
      });
      await clickButton('保存');
      await clickButton('确认保存');

      await waitFor(() => expect(body).not.toBeNull(), { timeout: 10_000 });
      expect(body).toMatchObject({ version: 4, name: '改名秒杀', stock: 50 });
      expect(body).not.toHaveProperty('courseId');
    },
    60_000,
  );

  it('取消秒杀：二次确认后调用取消接口', async () => {
    // 取消访问的 URL
    let cancelUrl = '';
    server.use(
      coursesHandler,
      listHandler(),
      http.post(/\/api\/v1\/admin\/flash-sales\/5\/cancel$/, ({ request }) => {
        cancelUrl = request.url;
        return HttpResponse.json(envelope({ ...draftSale, status: 'cancelled' }));
      }),
    );

    renderWithProviders(
      [{ path: '/admin/flash-sales', element: <FlashSaleListPage /> }],
      '/admin/flash-sales',
    );

    const row = (await screen.findByText('限时秒杀')).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: '取消' }));
    await clickButton('确认取消');

    await waitFor(() =>
      expect(cancelUrl).toMatch(/\/admin\/flash-sales\/5\/cancel$/),
    );
  });
});
