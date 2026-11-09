import { SetMetadata } from '@nestjs/common';

// 角色元数据键：用于存储接口所需的角色列表
export const ROLES = 'ROLES';

// Roles 装饰器：设置控制器方法所需的角色权限
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);
