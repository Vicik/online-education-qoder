import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import AdminLayout from '@/components/layout/AdminLayout';
import AuthLayout from '@/components/layout/AuthLayout';
import UserCenterLayout from '@/components/layout/UserCenterLayout';
import UserLayout from '@/components/layout/UserLayout';
import { PageLoading } from '@/components/common/PageLoading';
import ForbiddenPage from '@/features/auth/ForbiddenPage';
import NotFoundPage from '@/features/auth/NotFoundPage';
import { GuardedRoute, type LazyPage, type LayoutKey, type RouteMeta } from './guards';

// 占位页面：后续步骤替换为真实 lazy 导入
function placeholder(title: string): LazyPage {
  return async () => {
    const { PagePlaceholder } = await import('@/components/common/PagePlaceholder');
    return { default: () => <PagePlaceholder title={title} /> };
  };
}

// 路由元信息：与设计框架 §5.1 一一对应
export const ROUTES: RouteMeta[] = [
  // 认证页
  { path: '/login', layout: 'auth', requiresAuth: false, lazy: () => import('@/features/auth/LoginPage') },
  { path: '/register', layout: 'auth', requiresAuth: false, lazy: () => import('@/features/auth/RegisterPage') },
  { path: '/admin/login', layout: 'auth', requiresAuth: false, lazy: () => import('@/features/auth/AdminLoginPage') },
  { path: '/403', layout: 'auth', requiresAuth: false, lazy: async () => ({ default: ForbiddenPage }) },
  { path: '*', layout: 'auth', requiresAuth: false, lazy: async () => ({ default: NotFoundPage }) },
  // 用户端
  { path: '/', layout: 'user', requiresAuth: false, lazy: placeholder('首页') },
  { path: '/courses', layout: 'user', requiresAuth: false, lazy: placeholder('课程列表') },
  { path: '/courses/:id', layout: 'user', requiresAuth: false, lazy: placeholder('课程详情') },
  { path: '/groupons', layout: 'user', requiresAuth: false, lazy: placeholder('拼团列表') },
  { path: '/groupons/:id', layout: 'user', requiresAuth: false, lazy: placeholder('拼团详情') },
  { path: '/flash-sales', layout: 'user', requiresAuth: false, lazy: placeholder('秒杀列表') },
  { path: '/flash-sales/:id', layout: 'user', requiresAuth: false, lazy: placeholder('秒杀详情') },
  { path: '/community', layout: 'user', requiresAuth: false, lazy: placeholder('学习社区') },
  { path: '/community/:postId', layout: 'user', requiresAuth: false, lazy: placeholder('帖子详情') },
  { path: '/community/new', layout: 'user', requiresAuth: true, roles: ['user'], lazy: placeholder('发布帖子') },
  { path: '/checkout/:courseId', layout: 'user', requiresAuth: true, roles: ['user'], lazy: placeholder('确认订单') },
  { path: '/order/:id/result', layout: 'user', requiresAuth: true, roles: ['user'], lazy: placeholder('支付结果') },
  { path: '/learning/:courseId', layout: 'user', requiresAuth: true, roles: ['user'], lazy: placeholder('学习页') },
  { path: '/exams', layout: 'user', requiresAuth: true, roles: ['user'], lazy: placeholder('考试列表') },
  { path: '/exams/:id', layout: 'user', requiresAuth: true, roles: ['user'], lazy: placeholder('考试详情') },
  // 用户中心
  { path: '/user', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: placeholder('学习概览') },
  { path: '/user/study-records', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: placeholder('学习记录') },
  { path: '/user/orders', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: placeholder('购买记录') },
  { path: '/user/exams', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: placeholder('我的考试') },
  { path: '/user/posts', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: placeholder('我的帖子') },
  { path: '/user/coupons', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: placeholder('我的优惠券') },
  { path: '/user/favorites', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: placeholder('我的收藏') },
  { path: '/user/profile', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: placeholder('修改资料') },
  { path: '/user/password', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: placeholder('修改密码') },
  // 管理端
  { path: '/admin', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('工作台') },
  { path: '/admin/courses', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('课程列表') },
  { path: '/admin/courses/create', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('创建课程') },
  { path: '/admin/courses/:id', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('课程工作区') },
  { path: '/admin/groupons', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('拼团管理') },
  { path: '/admin/flash-sales', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('秒杀管理') },
  { path: '/admin/questions', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('题库管理') },
  { path: '/admin/questions/create', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('创建题目') },
  { path: '/admin/questions/:id', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('题目编辑') },
  { path: '/admin/exams', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('考试管理') },
  { path: '/admin/exams/create', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('创建考试') },
  { path: '/admin/exams/:id', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('考试编辑') },
  { path: '/admin/coupons', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('优惠券') },
  { path: '/admin/coupons/:id', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('优惠券编辑') },
  { path: '/admin/blocked-words', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: placeholder('屏蔽词') },
];

// 把同一布局的路由包装为懒加载 + 守卫
function layoutChildren(layout: LayoutKey): RouteObject[] {
  return ROUTES.filter((meta) => meta.layout === layout).map((meta) => {
    const Page: ComponentType = lazy(meta.lazy);
    return {
      path: meta.path,
      element: (
        <GuardedRoute meta={meta}>
          <Suspense fallback={<PageLoading />}>
            <Page />
          </Suspense>
        </GuardedRoute>
      ),
    };
  });
}

// 生成路由对象；测试用 createMemoryRouter 复用
export function createAppRoutes(): RouteObject[] {
  return [
    { element: <AuthLayout />, children: layoutChildren('auth') },
    { element: <UserLayout />, children: layoutChildren('user') },
    { element: <UserCenterLayout />, children: layoutChildren('user-center') },
    { element: <AdminLayout />, children: layoutChildren('admin') },
  ];
}

// 应用路由
export const router = createBrowserRouter(createAppRoutes());
