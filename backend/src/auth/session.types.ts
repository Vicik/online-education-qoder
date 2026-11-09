import 'express-session';
import { UserRole } from '@prisma/client';

// 扩展 express-session 的会话数据类型：登录后只存用户 id 与角色
declare module 'express-session' {
  interface SessionData {
    userId?: number; // 当前登录用户 id
    role?: UserRole; // 当前登录用户角色
  }
}
