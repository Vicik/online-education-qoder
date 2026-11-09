import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../constants/error-codes';
import { BizException } from '../exceptions/biz.exception';
import { ROLES } from '../decorators/roles.decorator';

// 角色守卫：验证当前用户是否具有访问接口所需的角色
@Injectable()
export class RolesGuard implements CanActivate {
  // 构造函数：注入反射器用于读取元数据
  constructor(private readonly reflector: Reflector) {}

  // 判断用户是否有权限访问：检查会话中的角色是否匹配接口要求的角色
  canActivate(context: ExecutionContext): boolean {
    // 获取接口要求的角色列表，支持从方法或类级别读取
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 如果没有设置角色要求，直接放行
    if (!roles || roles.length === 0) return true;

    // 从请求会话中获取当前用户角色
    const role = context.switchToHttp().getRequest<{
      session?: { role?: string };
    }>().session?.role;
    // 如果用户没有角色或角色不在允许列表中，抛出禁止访问异常
    if (!role || !roles.includes(role)) {
      throw new BizException(ErrorCode.FORBIDDEN, '无权限访问', 403);
    }
    // 角色验证通过，放行
    return true;
  }
}
