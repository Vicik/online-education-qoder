import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CourseCreatePage from '@/features/admin/courses/CourseCreatePage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-admin-create' };
}

// 创建页与工作区占位路由
const routes = [
  { path: '/admin/courses/create', element: <CourseCreatePage /> },
  { path: '/admin/courses/:id', element: <div>workspace</div> },
];

// 填必填项：金额用 change 直接赋值，避免 InputNumber 逐键格式化干扰
async function fillRequired(original: string, sale: string) {
  await userEvent.type(screen.getByLabelText('课程名称'), '新课');
  fireEvent.change(screen.getByPlaceholderText('原价（元）'), {
    target: { value: original },
  });
  fireEvent.change(screen.getByPlaceholderText('售价（元）'), {
    target: { value: sale },
  });
}

describe('CourseCreatePage', () => {
  it('售价高于原价时提示且不发请求', async () => {
    // 是否发出创建请求
    let posted = false;
    server.use(
      http.post(/\/api\/v1\/admin\/courses$/, () => {
        posted = true;
        return HttpResponse.json(envelope({ id: 8, status: 'draft', version: 1 }), {
          status: 201,
        });
      }),
    );

    renderWithProviders(routes, '/admin/courses/create');
    await fillRequired('10', '20');
    await userEvent.click(screen.getByRole('button', { name: '保存并维护章节' }));

    expect(await screen.findByText('售价不得高于原价')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('保存成功后进入章节维护，提交元转分与讲师', async () => {
    // 捕获创建请求体
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post(/\/api\/v1\/admin\/courses$/, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(envelope({ id: 8, status: 'draft', version: 1 }), {
          status: 201,
        });
      }),
    );

    const { router } = renderWithProviders(routes, '/admin/courses/create');
    await fillRequired('100', '90');
    await userEvent.type(screen.getByLabelText('讲师'), '王老师');
    await userEvent.click(screen.getByRole('button', { name: '保存并维护章节' }));
    await userEvent.click(await screen.findByRole('button', { name: '保存' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/admin/courses/8'),
    );
    expect(router.state.location.search).toBe('?step=chapters');
    expect(body).toMatchObject({
      name: '新课',
      type: 'video',
      originalCents: 10000,
      saleCents: 9000,
      instructor: '王老师',
    });
  });
});
