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
    );
    render(<App />);
    expect(await screen.findByText('知序课堂')).toBeInTheDocument();
  });
});
