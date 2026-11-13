import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CoursePreviewPage from '@/features/admin/courses/CoursePreviewPage';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/render';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-preview' };
}

// 已下架课程详情桩：含简介、详细介绍与拼团活动
function courseDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: '虚拟机使用',
    type: 'video',
    coverKey: null,
    coverUrl: null,
    instructor: '张老师',
    originalCents: 200000,
    saleCents: 100000,
    status: 'unpublished',
    intro: '虚拟机入门使用',
    detailRich: '<p>虚拟机详细介绍</p>',
    chapters: [{ id: 24, title: '章节1', contentType: 'video', sortOrder: 1 }],
    groupon: {
      id: 3,
      courseId: 42,
      courseName: '虚拟机使用',
      name: '双人成团',
      priceCents: 6900,
      targetSize: 2,
      startAt: '2026-11-01T00:00:00.000Z',
      endAt: '2099-12-01T00:00:00.000Z',
      status: 'ongoing',
    },
    flashSale: null,
    claimableCoupons: [],
    version: 5,
    ...overrides,
  };
}

// 管理端详情接口桩
function mockDetail(overrides: Record<string, unknown> = {}) {
  server.use(
    http.get(/\/api\/v1\/admin\/courses\/42$/, () =>
      HttpResponse.json(envelope(courseDetail(overrides))),
    ),
  );
}

// 拼团详情桩：用于展示待成团团组
function mockGrouponGroups() {
  server.use(
    http.get(/\/api\/v1\/groupons\/3$/, () =>
      HttpResponse.json(
        envelope({
          ...courseDetail().groupon,
          groups: [
            {
              id: 8,
              status: 'pending',
              memberCount: 1,
              targetSize: 2,
              expiresAt: '2099-12-01T00:00:00.000Z',
              formedAt: null,
              leaderNickname: '团长甲',
            },
          ],
        }),
      ),
    ),
  );
}

describe('CoursePreviewPage', () => {
  beforeEach(() => mockGrouponGroups());

  it('展示课程内容但隐藏购买互动与精品推荐', async () => {
    mockDetail();

    renderWithProviders(
      [{ path: '/admin/courses/:id/preview', element: <CoursePreviewPage /> }],
      '/admin/courses/42/preview',
    );

    // 预览提示、标题与活动横幅
    expect(
      await screen.findByText('预览模式：仅展示课程内容，购买、优惠券、收藏与拼团操作已隐藏'),
    ).toBeInTheDocument();
    expect(screen.getByText('虚拟机使用')).toBeInTheDocument();
    expect(screen.getByText('2人拼团')).toBeInTheDocument();
    // 团组只展示信息，不提供参团按钮
    expect(await screen.findByText('团长甲')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '去拼团' })).not.toBeInTheDocument();

    // 普通用户操作全部隐藏
    expect(screen.queryByRole('button', { name: '立即拼团' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即购买' })).not.toBeInTheDocument();
    expect(screen.queryByText('领取优惠券')).not.toBeInTheDocument();
    expect(screen.queryByText('精品推荐')).not.toBeInTheDocument();
  });

  it('简介显示在售价下方，详情页签不再有课程概述标题', async () => {
    mockDetail();

    renderWithProviders(
      [{ path: '/admin/courses/:id/preview', element: <CoursePreviewPage /> }],
      '/admin/courses/42/preview',
    );

    // 简介段落紧跟在价格行之后
    const intro = await screen.findByText('虚拟机入门使用');
    expect(intro.previousElementSibling).toHaveClass('course-detail-price');
    // 详情页签移除「课程概述」标题，正文照常展示
    expect(screen.queryByRole('heading', { name: '课程概述' })).not.toBeInTheDocument();
    expect(screen.getByText('虚拟机详细介绍')).toBeInTheDocument();

    // 章节目录页签可切换
    await userEvent.click(screen.getByRole('tab', { name: '章节目录' }));
    expect(await screen.findByText(/章节1/)).toBeInTheDocument();
  });
});
