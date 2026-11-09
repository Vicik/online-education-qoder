import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';

// 当前用户信息接口：定义从会话中提取的用户基本信息结构
export interface CurrentUserInfo {
  userId: number; // 用户唯一标识
  role: UserRole; // 用户角色
}

// CurrentUser 参数装饰器：从请求会话中提取当前登录用户的信息
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUserInfo | null => {
    // 获取 HTTP 请求对象及其会话
    const session = context.switchToHttp().getRequest<{
      session?: { userId?: number; role?: UserRole };
    }>().session;
    // 未登录（无 id 或角色）时返回 null，交由 SessionGuard 先行拦截
    if (!session?.userId || !session.role) return null;
    // 返回会话中的用户标识与角色
    return { userId: session.userId, role: session.role };
  },
);
