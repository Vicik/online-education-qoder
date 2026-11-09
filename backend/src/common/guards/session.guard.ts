import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../constants/error-codes';
import { BizException } from '../exceptions/biz.exception';
import { IS_PUBLIC } from '../decorators/public.decorator';

// 会话守卫：验证用户是否已登录，公开接口跳过验证
@Injectable()
export class SessionGuard implements CanActivate {
  // 构造函数：注入反射器用于读取元数据
  constructor(private readonly reflector: Reflector) {}

  // 判断请求是否允许通过：检查会话中是否存在用户 ID
  canActivate(context: ExecutionContext): boolean {
    // 检查接口是否标记为公开访问
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 如果是公开接口，直接放行
    if (isPublic) return true;

    // 从请求会话中获取用户 ID
    const session = context.switchToHttp().getRequest<{
      session?: { userId?: number };
    }>().session;
    // 如果会话中没有用户 ID，抛出未授权异常
    if (!session?.userId) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', 401);
    }
    // 用户已登录，放行
    return true;
  }
}
