import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import BlockedWordListPage from '@/features/admin/blocked-words/BlockedWordListPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-blocked-word' };
}

// 屏蔽词桩
const blockedWord = { id: 7, word: '代考', status: 'enabled' };

// 渲染列表
function renderList() {
  return renderWithProviders(
    [{ path: '/admin/blocked-words', element: <BlockedWordListPage /> }],
    '/admin/blocked-words',
  );
}

describe('BlockedWordListPage', () => {
  it('新增屏蔽词带幂等键；重复词 409 行内提示且弹窗保持打开', async () => {
    // 交互实例：去掉每一步的延迟，加快弹窗与下拉操作
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    // 创建请求体
    let body: Record<string, unknown> | null = null;
    // 创建幂等键
    let key: string | null = null;
    // 第几次创建请求
    let createCount = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/blocked-words$/, () =>
        HttpResponse.json(
          envelope({ items: [blockedWord], total: 1, page: 1, pageSize: 10 }),
        ),
      ),
      http.post(/\/api\/v1\/admin\/blocked-words$/, async ({ request }) => {
        createCount += 1;
        body = (await request.json()) as Record<string, unknown>;
        key = request.headers.get('idempotency-key');
        if (createCount === 1) {
          return HttpResponse.json(envelope({ id: 8, word: '替考', status: 'enabled' }), {
            status: 201,
          });
        }
        return HttpResponse.json(
          {
            code: 1001,
            message: '屏蔽词已存在',
            data: null,
            requestId: 'r-duplicate',
          },
          { status: 409 },
        );
      }),
    );

    renderList();

    // 第一次：创建成功
    await user.click(
      await screen.findByRole('button', { name: '新增屏蔽词' }),
    );
    await user.type(
      screen.getByPlaceholderText('输入需要屏蔽的词'),
      '替考',
    );
    await user.click(screen.getByRole('button', { name: '保存' }));
    await user.click(await screen.findByRole('button', { name: '确认保存' }));

    await waitFor(() => expect(body).toEqual({ word: '替考' }));
    expect(key).toMatch(/^[0-9a-f-]{36}$/);

    // 第二次：重复词，行内报错
    await user.click(
      await screen.findByRole('button', { name: '新增屏蔽词' }),
    );
    await user.type(
      screen.getByPlaceholderText('输入需要屏蔽的词'),
      '替考',
    );
    await user.click(screen.getByRole('button', { name: '保存' }));
    await user.click(await screen.findByRole('button', { name: '确认保存' }));

    expect(await screen.findByText('该屏蔽词已存在')).toBeInTheDocument();
    expect(createCount).toBe(2);
  }, 60_000);

  it('按状态筛选；停用、改词与删除均二次确认', async () => {
    // 交互实例：去掉每一步的延迟，加快弹窗与下拉操作
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    // 最近一次列表查询参数
    let query = new URLSearchParams();
    // 更新请求体
    let updateBody: Record<string, unknown> | null = null;
    // 删除访问次数
    let deleteCount = 0;
    server.use(
      http.get(/\/api\/v1\/admin\/blocked-words$/, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(
          envelope({ items: [blockedWord], total: 1, page: 1, pageSize: 10 }),
        );
      }),
      http.put(/\/api\/v1\/admin\/blocked-words\/7$/, async ({ request }) => {
        updateBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(envelope(null));
      }),
      http.delete(/\/api\/v1\/admin\/blocked-words\/7$/, () => {
        deleteCount += 1;
        return HttpResponse.json(envelope(null));
      }),
    );

    renderList();

    // 状态筛选
    await user.click(
      await screen.findByRole('combobox', { name: '状态筛选' }),
    );
    await user.click(await screen.findByText('已停用'));
    await waitFor(() => expect(query.get('status')).toBe('disabled'));

    // 停用
    await user.click(screen.getByRole('button', { name: '停用' }));
    await user.click(await screen.findByRole('button', { name: '确认停用' }));
    await waitFor(() =>
      expect(updateBody).toEqual({ status: 'disabled' }),
    );

    // 改词
    await user.click(screen.getByRole('button', { name: '编辑' }));
    const wordInput = await screen.findByPlaceholderText('输入需要屏蔽的词');
    await user.clear(wordInput);
    await user.type(wordInput, '替考');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await user.click(await screen.findByRole('button', { name: '确认保存' }));
    await waitFor(() =>
      expect(updateBody).toEqual({ word: '替考', status: 'enabled' }),
    );

    // 删除
    await user.click(screen.getByRole('button', { name: '删除' }));
    await user.click(await screen.findByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(deleteCount).toBe(1));
  }, 60_000);
});
