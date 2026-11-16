import { buildLoginRedirect } from '@/app/login-redirect';

describe('buildLoginRedirect', () => {
  it('保留原路径与查询串', () => {
    expect(buildLoginRedirect('/courses/1?tab=detail', false)).toBe(
      '/login?redirect=%2Fcourses%2F1%3Ftab%3Ddetail',
    );
  });

  it('会话过期时附带 expired=1', () => {
    expect(buildLoginRedirect('/admin', true)).toBe('/login?redirect=%2Fadmin&expired=1');
  });
});
