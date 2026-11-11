import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
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
  chapterCount: 2,
  enrollmentCount: 3,
};

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
});
