import { http, HttpResponse } from 'msw';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FavoritesPage from '@/features/user-center/FavoritesPage';
import { useSessionStore } from '@/stores/session';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-fav' };
}

// 收藏课程桩
function course(id: number, name: string) {
  return {
    id,
    name,
    type: 'video',
    coverKey: null,
    coverUrl: null,
    instructor: null,
    originalCents: 10000,
    saleCents: 9000,
    status: 'published',
  };
}

describe('FavoritesPage', () => {
  beforeEach(() => {
    useSessionStore.getState().setUser({
      id: 2,
      email: 'user@example.com',
      nickname: '学员',
      avatarKey: null,
      avatarUrl: null,
      gender: 'secret',
      role: 'user',
      createdAt: '2026-11-01T00:00:00.000Z',
    } as never);
  });

  afterEach(() => {
    // 先卸载组件再清空登录态，避免已挂载组件在 act 外更新
    cleanup();
    useSessionStore.getState().clear();
  });

  it('取消收藏经确认后调用 DELETE 并刷新空态', async () => {
    // 删除请求次数
    let deleted = 0;
    // 删除后列表为空
    let removed = false;
    server.use(
      http.get(/\/api\/v1\/user\/favorites$/, () =>
        HttpResponse.json(
          envelope({
            items: removed ? [] : [course(1, 'TypeScript 系统入门')],
            total: removed ? 0 : 1,
            page: 1,
            pageSize: 12,
          }),
        ),
      ),
      http.delete(/\/api\/v1\/favorites\/1$/, () => {
        deleted += 1;
        removed = true;
        return HttpResponse.json(envelope(null));
      }),
    );

    renderWithProviders(
      [{ path: '/user/favorites', element: <FavoritesPage /> }],
      '/user/favorites',
    );

    expect(await screen.findByText('TypeScript 系统入门')).toBeInTheDocument();
    // 改版后入口为「删除」，二次确认后调用取消收藏接口
    await userEvent.click(screen.getByRole('button', { name: '删除' }));
    await userEvent.click(await screen.findByRole('button', { name: /确\s*定/ }));

    await waitFor(() => expect(deleted).toBe(1));
    expect(await screen.findByText('暂无收藏')).toBeInTheDocument();
  });
});
