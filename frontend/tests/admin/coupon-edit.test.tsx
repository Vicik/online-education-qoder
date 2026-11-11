import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import CouponEditPage from '@/features/admin/coupons/CouponEditPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-coupon-edit' };
}

// 停用模板桩
const disabledTemplate = {
  id: 9,
  name: '满 100 减 20',
  discountCents: 2000,
  startAt: '2026-11-20T00:00:00.000Z',
  endAt: '2026-12-20T00:00:00.000Z',
  totalQty: 100,
  claimedCount: 5,
  status: 'disabled',
  courseIds: [2],
  version: 3,
};

// 启用模板桩
const enabledTemplate = { ...disabledTemplate, status: 'enabled' };

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

// 渲染编辑页
function renderEdit() {
  return renderWithProviders(
    [{ path: '/admin/coupons/:id', element: <CouponEditPage /> }],
    '/admin/coupons/9',
  );
}

// 点按钮：按文本定位后取最近的 button，避免 jsdom 中昂贵的可访问名计算
async function clickButton(label: string) {
  // 按钮内文本节点（antd 渲染为 span）
  const text = await screen.findByText(label);
  // 最近的可点击祖先
  const button = text.closest('button');
  if (!button) throw new Error(`未找到按钮：${label}`);
  fireEvent.click(button);
}

describe('CouponEditPage', () => {
  it('启用态只读并提示先停用', async () => {
    server.use(
      coursesHandler,
      http.get(/\/api\/v1\/admin\/coupons\/9$/, () =>
        HttpResponse.json(envelope(enabledTemplate)),
      ),
    );

    renderEdit();

    expect(
      await screen.findByText('模板已启用，请先停用后再编辑'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('券名称')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it(
    '停用态保存携带 version，成功后回填新版本',
    async () => {
      // 编辑请求体
      let body: Record<string, unknown> | null = null;
      // 当前详情版本（保存后变 4）
      let currentVersion = 3;
      server.use(
        coursesHandler,
        http.get(/\/api\/v1\/admin\/coupons\/9$/, () =>
          HttpResponse.json(
            envelope({ ...disabledTemplate, version: currentVersion }),
          ),
        ),
        http.put(/\/api\/v1\/admin\/coupons\/9$/, async ({ request }) => {
          body = (await request.json()) as Record<string, unknown>;
          currentVersion = 4;
          return HttpResponse.json(
            envelope({ ...disabledTemplate, name: '改名券', version: 4 }),
          );
        }),
      );

      renderEdit();

      const nameInput = await screen.findByLabelText('券名称');
      expect(nameInput).toHaveValue('满 100 减 20');
      fireEvent.change(nameInput, { target: { value: '改名券' } });
      await clickButton('保存');
      await clickButton('确认保存');

      await waitFor(() => expect(body).not.toBeNull(), { timeout: 10_000 });
      expect(body).toMatchObject({ version: 3, name: '改名券' });

      // 保存后重新取详情，表单回填新版本数据
      await waitFor(() =>
        expect(screen.getByLabelText('券名称')).toHaveValue('改名券'),
      );
    },
    60_000,
  );

  it(
    '保存遇 409：弹出刷新提示，点刷新重取详情',
    async () => {
      // 详情请求次数
      let detailCount = 0;
      // 当前详情版本（刷新后变 4）
      let currentVersion = 3;
      server.use(
        coursesHandler,
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

      renderEdit();

      await screen.findByLabelText('券名称');
      await clickButton('保存');
      await clickButton('确认保存');

      expect(
        (await screen.findAllByText('内容已在其他页面被修改')).length,
      ).toBeGreaterThan(0);
      // 初始 1 次 + 刷新 1 次
      expect(detailCount).toBe(1);
      await clickButton('刷新');
      await waitFor(() => expect(detailCount).toBe(2), { timeout: 10_000 });
    },
    60_000,
  );
});
