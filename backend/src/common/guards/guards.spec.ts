import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from '../decorators/public.decorator';
import { Roles } from '../decorators/roles.decorator';
import { SessionGuard } from './session.guard';
import { RolesGuard } from './roles.guard';

class PrivateController {
  method() {
    /* noop */
  }
}

class PublicController {
  @Public()
  method() {
    /* noop */
  }
}

function mockCtx(target: object, session?: unknown): ExecutionContext {
  const instance = Object.create(target);
  return {
    getHandler: () => instance.method,
    getClass: () => (target as { constructor: unknown }).constructor,
    switchToHttp: () => ({ getRequest: () => ({ session }) }),
  } as unknown as ExecutionContext;
}

describe('SessionGuard', () => {
  const guard = new SessionGuard(new Reflector());

  it('无会话抛 2001/401', () => {
    const ctx = mockCtx(PrivateController.prototype);
    expect(() => guard.canActivate(ctx)).toThrowError(
      expect.objectContaining({ bizCode: 2001 }),
    );
  });

  it('有会话放行', () => {
    const ctx = mockCtx(PrivateController.prototype, { userId: 1 });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('@Public 标记的处理器跳过校验', () => {
    const ctx = mockCtx(PublicController.prototype);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

class AdminController {
  @Roles('admin')
  method() {
    /* noop */
  }
}

class UserController {
  method() {
    /* noop */
  }
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('未标注角色的处理器直接放行', () => {
    const ctx = mockCtx(UserController.prototype, { userId: 1 });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('角色匹配放行', () => {
    const ctx = mockCtx(AdminController.prototype, {
      userId: 1,
      role: 'admin',
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('角色不符抛 2002/403', () => {
    const ctx = mockCtx(AdminController.prototype, { userId: 1, role: 'user' });
    expect(() => guard.canActivate(ctx)).toThrowError(
      expect.objectContaining({ bizCode: 2002 }),
    );
  });

  it('无会话角色抛 2002/403', () => {
    const ctx = mockCtx(AdminController.prototype);
    expect(() => guard.canActivate(ctx)).toThrowError(
      expect.objectContaining({ bizCode: 2002 }),
    );
  });
});
