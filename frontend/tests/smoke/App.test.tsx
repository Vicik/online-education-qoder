import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import App from '@/App';
import { server } from '../msw/server';

// 冒烟测试：未登录时仍可渲染用户端导航
describe('App', () => {
  it('渲染导航品牌「知序课堂」', async () => {
    server.use(
      http.get(/\/api\/v1\/auth\/me$/, () =>
        HttpResponse.json(
          { code: 2001, message: '未登录', data: null, requestId: 'r-me' },
          { status: 401 },
        ),
      ),
      // 首页两个区块：空数据即可，避免未拦截请求
      http.get(/\/api\/v1\/home\/recommendations$/, () =>
        HttpResponse.json({ code: 0, message: 'ok', data: { courses: [] }, requestId: 'r-home' }),
      ),
      http.get(/\/api\/v1\/courses$/, () =>
        HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { items: [], total: 0, page: 1, pageSize: 8 },
          requestId: 'r-courses',
        }),
      ),
    );
    render(<App />);
    expect(await screen.findByRole('link', { name: '知序课堂' })).toBeInTheDocument();
  });
});

