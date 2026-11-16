import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import AdminLayout from '@/components/layout/AdminLayout';
import AuthLayout from '@/components/layout/AuthLayout';
import UserCenterLayout from '@/components/layout/UserCenterLayout';
import UserLayout from '@/components/layout/UserLayout';
import { PageLoading } from '@/components/common/PageLoading';
import ForbiddenPage from '@/features/auth/ForbiddenPage';
import NotFoundPage from '@/features/auth/NotFoundPage';
import { GuardedRoute, type LayoutKey, type RouteMeta } from './guards';

// 路由元信息：与设计框架 §5.1 一一对应
export const ROUTES: RouteMeta[] = [
  // 认证页
  { path: '/login', layout: 'auth', requiresAuth: false, lazy: () => import('@/features/auth/LoginPage') },
  { path: '/register', layout: 'auth', requiresAuth: false, lazy: () => import('@/features/auth/RegisterPage') },
  { path: '/403', layout: 'auth', requiresAuth: false, lazy: async () => ({ default: ForbiddenPage }) },
  { path: '*', layout: 'auth', requiresAuth: false, lazy: async () => ({ default: NotFoundPage }) },
  // 用户端
  { path: '/', layout: 'user', requiresAuth: false, lazy: () => import('@/features/home/HomePage') },
  { path: '/courses', layout: 'user', requiresAuth: false, lazy: () => import('@/features/catalog/CourseListPage') },
  { path: '/courses/:id', layout: 'user', requiresAuth: false, lazy: () => import('@/features/catalog/CourseDetailPage') },
  { path: '/groupons', layout: 'user', requiresAuth: false, lazy: () => import('@/features/groupon/GrouponListPage') },
  { path: '/groupons/:id', layout: 'user', requiresAuth: false, lazy: () => import('@/features/groupon/GrouponDetailPage') },
  { path: '/flash-sales', layout: 'user', requiresAuth: false, lazy: () => import('@/features/flash-sale/FlashSaleListPage') },
  { path: '/flash-sales/:id', layout: 'user', requiresAuth: false, lazy: () => import('@/features/flash-sale/FlashSaleDetailPage') },
  { path: '/community', layout: 'user', requiresAuth: false, lazy: () => import('@/features/community/FeedPage') },
  { path: '/community/new', layout: 'user', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/community/NewPostPage') },
  { path: '/community/:postId', layout: 'user', requiresAuth: false, lazy: () => import('@/features/community/PostDetailPage') },
  { path: '/checkout/coupon/:couponId', layout: 'user', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/checkout/CouponCheckoutPage') },
  { path: '/checkout/:courseId', layout: 'user', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/checkout/CheckoutPage') },
  { path: '/order/:id/pay', layout: 'user', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/checkout/OrderPayPage') },
  { path: '/order/:id/result', layout: 'user', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/checkout/OrderResultPage') },
  { path: '/learning/:courseId', layout: 'user', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/learning/LearningPage') },
  { path: '/exams', layout: 'user', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/exam/ExamListPage') },
  { path: '/exams/:id', layout: 'user', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/exam/ExamDetailPage') },
  // 用户中心
  { path: '/user', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/user-center/OverviewPage') },
  { path: '/user/study-records', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/user-center/StudyRecordsPage') },
  { path: '/user/orders', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/user-center/OrdersPage') },
  { path: '/user/exams', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/exam/MyExamsPage') },
  { path: '/user/posts', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/community/MyPostsPage') },
  { path: '/user/coupons', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/coupon/MyCouponsPage') },
  { path: '/user/favorites', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/user-center/FavoritesPage') },
  { path: '/user/profile', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/user-center/ProfilePage') },
  { path: '/user/password', layout: 'user-center', requiresAuth: true, roles: ['user'], lazy: () => import('@/features/user-center/PasswordPage') },
  // 管理端
  { path: '/admin', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/dashboard/DashboardPage') },
  { path: '/admin/courses', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/courses/CourseListPage') },
  { path: '/admin/courses/create', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/courses/CourseCreatePage') },
  // 预览页使用用户端布局（无管理端侧栏），由顶部品牌与头像承载导航
  { path: '/admin/courses/:id/preview', layout: 'user', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/courses/CoursePreviewPage') },
  { path: '/admin/courses/:id', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/courses/CourseWorkspacePage') },
  { path: '/admin/groupons', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/groupons/GrouponListPage') },
  { path: '/admin/flash-sales', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/flash-sales/FlashSaleListPage') },
  { path: '/admin/questions', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/questions/QuestionListPage') },
  { path: '/admin/questions/create', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/questions/QuestionCreatePage') },
  { path: '/admin/questions/:id', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/questions/QuestionEditPage') },
  { path: '/admin/exams', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/exams/ExamListPage') },
  { path: '/admin/exams/create', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/exams/ExamCreatePage') },
  { path: '/admin/exams/:id', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/exams/ExamEditPage') },
  { path: '/admin/coupons', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/coupons/CouponListPage') },
  { path: '/admin/coupons/:id', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/coupons/CouponEditPage') },
  { path: '/admin/blocked-words', layout: 'admin', requiresAuth: true, roles: ['admin'], lazy: () => import('@/features/admin/blocked-words/BlockedWordListPage') },
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
