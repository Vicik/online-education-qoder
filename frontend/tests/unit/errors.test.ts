import { ApiError, getErrorAction, handleAuthError, registerAuthHandlers } from '@/api/errors';

describe('errors', () => {
  it('错误码映射到设计框架 §6.2 的动作', () => {
    expect(getErrorAction(2003)).toBe('bad-credentials');
    expect(getErrorAction(4003)).toBe('duplicate-purchase');
    expect(getErrorAction(4004)).toBe('idempotent-replay');
    expect(getErrorAction(5001)).toBe('group-full');
    expect(getErrorAction(7001)).toBe('blocked-word');
    expect(getErrorAction(409)).toBe('version-conflict');
    expect(getErrorAction(9999)).toBe('inline');
  });
  it('2001/2002 调用注册的处理器', () => {
    const onUnauthorized = vi.fn();
    const onForbidden = vi.fn();
    registerAuthHandlers({ onUnauthorized, onForbidden });
    expect(handleAuthError(new ApiError(2001, '未登录', null, 'r1', 401))).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    handleAuthError(new ApiError(2002, '无权访问', null, 'r2', 403));
    expect(onForbidden).toHaveBeenCalledOnce();
  });
});
