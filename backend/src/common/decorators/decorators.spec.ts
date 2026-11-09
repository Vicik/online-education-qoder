import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';

function mockCtx(session: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ session }) }),
  } as unknown as ExecutionContext;
}

function currentUserWith(session: unknown): unknown {
  class C {
    m(@CurrentUser() _user: unknown) {
      /* noop */
    }
  }
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, C, 'm') as Record<
    string,
    {
      data: unknown;
      factory: (data: unknown, ctx: ExecutionContext) => unknown;
    }
  >;
  const entry = Object.values(metadata)[0];
  return entry.factory(entry.data, mockCtx(session));
}

describe('decorators', () => {
  it('@Public 写入路由元信息', () => {
    class C {
      @Public()
      m() {
        /* noop */
      }
    }
    expect(Reflect.getMetadata('IS_PUBLIC', C.prototype.m)).toBe(true);
  });

  it('@Roles 写入角色元信息', () => {
    class C {
      @Roles('admin', 'ops')
      m() {
        /* noop */
      }
    }
    expect(Reflect.getMetadata('ROLES', C.prototype.m)).toEqual([
      'admin',
      'ops',
    ]);
  });

  it('@CurrentUser 注入会话用户', () => {
    expect(currentUserWith({ userId: 1, role: 'user' })).toEqual({
      userId: 1,
      role: 'user',
    });
  });

  it('@CurrentUser 无会话时返回 null', () => {
    expect(currentUserWith({})).toBeNull();
  });

  it('@CurrentUser 会话缺少角色时返回 null', () => {
    expect(currentUserWith({ userId: 1 })).toBeNull();
  });
});
