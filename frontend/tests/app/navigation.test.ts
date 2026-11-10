import {
  ADMIN_NAV_ITEMS,
  USER_CENTER_NAV_ITEMS,
  getAdminSelectedKey,
  getUserCenterSelectedKey,
  getUserNavItems,
} from '@/app/navigation';

describe('navigation', () => {
  it('游客与普通用户顶部导航差异只在「考试」', () => {
    expect(getUserNavItems(null).map((item) => item.label)).toEqual([
      '首页', '全部课程', '拼团', '秒杀', '学习社区',
    ]);
    expect(getUserNavItems('user').map((item) => item.label)).toEqual([
      '首页', '全部课程', '拼团', '秒杀', '学习社区', '考试',
    ]);
  });
  it('用户中心 9 项与管理端 8 项', () => {
    expect(USER_CENTER_NAV_ITEMS).toHaveLength(9);
    expect(ADMIN_NAV_ITEMS).toHaveLength(8);
    expect(ADMIN_NAV_ITEMS.some((item) => item.label === '查看用户端')).toBe(false);
  });
  it('子路由按模块前缀高亮', () => {
    expect(getAdminSelectedKey('/admin/courses/create')).toBe('/admin/courses');
    expect(getAdminSelectedKey('/admin/courses/12')).toBe('/admin/courses');
    expect(getAdminSelectedKey('/admin/exams/3')).toBe('/admin/exams');
    expect(getAdminSelectedKey('/admin')).toBe('/admin');
    expect(getUserCenterSelectedKey('/user/study-records')).toBe('/user/study-records');
    expect(getUserCenterSelectedKey('/user')).toBe('/user');
  });
});
