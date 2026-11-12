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

// 选择封面：走 ImageUploader 内部的 antd Upload 输入框，等待上传完成回填 key
async function uploadCover() {
  // antd Upload 的隐藏文件输入（页面内唯一的 antd Upload）
  const input = document.querySelector<HTMLInputElement>(
    '.ant-upload input[type="file"]',
  );
  // 合法 PNG：满足类型与大小预检
  const file = new File(['cover'], 'cover.png', { type: 'image/png' });
  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });
  // 上传成功后按钮文案切换为「更换图片」
  await screen.findByRole('button', { name: '更换图片' });
}

describe('CourseCreatePage', () => {
  it('讲师与封面未填时提示必填且不发请求', async () => {
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
    await fillRequired('100', '90');
    await userEvent.click(screen.getByRole('button', { name: '保存并维护章节' }));

    expect(await screen.findByText('请输入讲师')).toBeInTheDocument();
    expect(await screen.findByText('请上传封面')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

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
      http.post(/\/api\/v1\/files\/upload$/, () =>
        HttpResponse.json(
          envelope({ key: 'image/demo/cover.png', url: 'https://cdn.test/cover.png' }),
        ),
      ),
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
    await uploadCover();
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
      coverUrl: 'image/demo/cover.png',
    });
    // 富文本编辑器与封面上传在 jsdom 中较慢，单独放宽本用例超时
  }, 60_000);
});
