import { SetMetadata } from '@nestjs/common';

// 公开接口元数据键：用于标记不需要身份验证的接口
export const IS_PUBLIC = 'IS_PUBLIC';

// Public 装饰器：标记控制器方法为公开访问，跳过身份验证
export const Public = () => SetMetadata(IS_PUBLIC, true);
