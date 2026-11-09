import { RequestHandler } from 'express';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/configuration';
import { SESSION_KEY_PREFIX } from './session.constants';
import './session.types'; // 引入 express-session 类型扩展

// 生产环境名：仅生产开启 Cookie Secure
const PRODUCTION = 'production';

// 构建 express-session 处理器：使用 Redis 存储，Cookie 固定 HttpOnly + SameSite=Lax
function createSessionHandler(cfg: AppConfig, client: Redis): RequestHandler {
  return session({
    // 会话存储：Redis，键前缀 sess:，TTL 与配置一致
    store: new RedisStore({
      client,
      prefix: SESSION_KEY_PREFIX,
      ttl: cfg.sessionTtl,
    }),
    // 会话签名密钥
    secret: cfg.sessionSecret,
    // 不重写未变更的会话，减少 Redis 写入
    resave: false,
    // 未登录的请求不创建空会话
    saveUninitialized: false,
    // 每次访问续期，活跃用户不掉线
    rolling: true,
    cookie: {
      // 禁止前端脚本读取
      httpOnly: true,
      // 生产环境仅 HTTPS 传输
      secure: process.env.NODE_ENV === PRODUCTION,
      // 跨站请求不携带（配合状态变更接口的 CSRF 防护）
      sameSite: 'lax',
      // 与服务端会话 TTL 对齐（毫秒）
      maxAge: cfg.sessionTtl * 1000,
    },
  });
}

// 会话中间件工厂：首个请求时才取 Redis 客户端并构建处理器
// （Nest 模块初始化完成后 Redis 客户端才就绪，且全局中间件需在路由注册前挂载）
export function sessionMiddleware(
  cfg: AppConfig,
  getClient: () => Redis,
): RequestHandler {
  // 惰性构建的会话处理器
  let handler: RequestHandler | undefined;
  // 返回包装后的中间件
  return (req, res, next): void => {
    handler ??= createSessionHandler(cfg, getClient());
    handler(req, res, next);
  };
}
