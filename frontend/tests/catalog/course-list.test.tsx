import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CourseListPage from '@/features/catalog/CourseListPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-list' };
}

// 课程桩
function course(id: number) {
  return {
    id,
    name: `课程 ${id}`,
    type: 'rich',
    coverKey: null,
    coverUrl: null,
    instructor: null,
    originalCents: 10000,
    saleCents: 8000,
    status: 'published',
  };
}

describe('CourseListPage', () => {
  it('翻页重新请求并替换列表', async () => {
    // 记录每次请求的页码
    const requestedPages: string[] = [];
    server.use(
      http.get(/\/api\/v1\/courses$/, ({ request }) => {
        const page = new URL(request.url).searchParams.get('page') ?? '1';
        requestedPages.push(page);
        return HttpResponse.json(
          envelope({
            items: [course(Number(page))],
            total: 25,
            page: Number(page),
            pageSize: 12,
          }),
        );
      }),
    );

    renderWithProviders([{ path: '/courses', element: <CourseListPage /> }], '/courses');

    expect(await screen.findByRole('heading', { name: '课程' })).toBeInTheDocument();
    expect(await screen.findByText('课程 1')).toBeInTheDocument();
    await userEvent.click(screen.getByTitle('2'));

    expect(await screen.findByText('课程 2')).toBeInTheDocument();
    expect(requestedPages).toContain('2');
  });

  it('空列表展示空态', async () => {
    server.use(
      http.get(/\/api\/v1\/courses$/, () =>
        HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 12 })),
      ),
    );

    renderWithProviders([{ path: '/courses', element: <CourseListPage /> }], '/courses');
    expect(await screen.findByText('暂无课程')).toBeInTheDocument();
  });
});
