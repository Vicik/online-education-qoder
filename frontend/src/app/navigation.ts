import type { Role } from './guards';

// 导航项：路径与展示文案
export interface NavItem {
  path: string;
  label: string;
}

// 用户端顶部导航（考试仅普通用户显示）
const USER_BASE_NAV_ITEMS: NavItem[] = [
  { path: '/', label: '首页' },
  { path: '/courses', label: '课程' },
  { path: '/groupons', label: '拼团' },
  { path: '/flash-sales', label: '秒杀' },
  { path: '/community', label: '社区' },
];

// 按角色返回顶部导航
export function getUserNavItems(role: Role | null): NavItem[] {
  // 仅普通用户追加「考试」入口
  return role === 'user'
    ? [...USER_BASE_NAV_ITEMS, { path: '/exams', label: '考试' }]
    : USER_BASE_NAV_ITEMS;
}

// 用户中心侧栏 9 项
export const USER_CENTER_NAV_ITEMS: NavItem[] = [
  { path: '/user', label: '学习概览' },
  { path: '/user/study-records', label: '学习记录' },
  { path: '/user/orders', label: '购买记录' },
  { path: '/user/exams', label: '我的考试' },
  { path: '/user/posts', label: '我的帖子' },
  { path: '/user/coupons', label: '我的优惠券' },
  { path: '/user/favorites', label: '我的收藏' },
  { path: '/user/profile', label: '修改资料' },
  { path: '/user/password', label: '修改密码' },
];

// 管理端侧栏 8 项（无「查看用户端」）
export const ADMIN_NAV_ITEMS: NavItem[] = [
  { path: '/admin', label: '工作台' },
  { path: '/admin/courses', label: '课程管理' },
  { path: '/admin/groupons', label: '拼团管理' },
  { path: '/admin/flash-sales', label: '秒杀管理' },
  { path: '/admin/questions', label: '题库管理' },
  { path: '/admin/exams', label: '考试管理' },
  { path: '/admin/coupons', label: '优惠券' },
  { path: '/admin/blocked-words', label: '屏蔽词' },
];

// 按最长前缀匹配侧栏项；根路径必须精确匹配
function findSelectedKey(items: NavItem[], pathname: string, rootPath: string): string {
  const matched = items
    .filter((item) =>
      item.path === rootPath ? pathname === rootPath : pathname.startsWith(item.path),
    )
    .sort((left, right) => right.path.length - left.path.length)[0];
  return matched?.path ?? rootPath;
}

// 管理端侧栏高亮
export function getAdminSelectedKey(pathname: string): string {
  return findSelectedKey(ADMIN_NAV_ITEMS, pathname, '/admin');
}

// 用户中心侧栏高亮
export function getUserCenterSelectedKey(pathname: string): string {
  return findSelectedKey(USER_CENTER_NAV_ITEMS, pathname, '/user');
}
