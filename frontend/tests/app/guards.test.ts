import { resolveRedirect, type RouteMeta } from '@/app/guards';

const protectedUserRoute: RouteMeta = {
  path: '/checkout/:courseId',
  layout: 'user',
  requiresAuth: true,
  roles: ['user'],
  lazy: async () => ({ default: () => null }),
};
const adminRoute: RouteMeta = { ...protectedUserRoute, path: '/admin', layout: 'admin', roles: ['admin'] };
const publicRoute: RouteMeta = { ...protectedUserRoute, path: '/courses', requiresAuth: false, roles: undefined };

describe('resolveRedirect', () => {
  it('游客访问受保护路由跳登录并带 redirect', () => {
    expect(resolveRedirect(null, protectedUserRoute, '/checkout/1?couponId=2')).toBe(
      '/login?redirect=%2Fcheckout%2F1%3FcouponId%3D2',
    );
  });
  it('管理员访问任何非 /admin 路由统一跳 /admin', () => {
    expect(resolveRedirect({ role: 'admin' } as never, publicRoute, '/courses')).toBe('/admin');
    expect(resolveRedirect({ role: 'admin' } as never, publicRoute, '/')).toBe('/admin');
    expect(resolveRedirect({ role: 'admin' } as never, publicRoute, '/user/orders')).toBe('/admin');
  });
  it('管理员可进入 /admin 与 /admin/login', () => {
    expect(resolveRedirect({ role: 'admin' } as never, adminRoute, '/admin/courses')).toBeNull();
    expect(resolveRedirect({ role: 'admin' } as never, publicRoute, '/admin/login')).toBeNull();
  });
  it('普通用户访问管理端跳 403', () => {
    expect(resolveRedirect({ role: 'user' } as never, adminRoute, '/admin/courses')).toBe('/403');
  });
  it('公开路由与匹配角色放行', () => {
    expect(resolveRedirect(null, publicRoute, '/courses')).toBeNull();
    expect(resolveRedirect({ role: 'user' } as never, protectedUserRoute, '/checkout/1')).toBeNull();
  });
});
