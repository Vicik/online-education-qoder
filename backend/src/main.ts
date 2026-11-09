import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { pinoHttp } from 'pino-http';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { sessionMiddleware } from './auth/session.middleware';
import { RedisService } from './redis/redis.service';

// 应用启动函数：初始化 NestJS 应用并配置中间件
async function bootstrap() {
  // 加载应用配置
  const config = loadConfig();
  // 创建 NestJS 应用实例
  const app = await NestFactory.create(AppModule);

  // 复用 Redis 连接作为会话存储（客户端在模块初始化后就绪，中间件惰性获取）
  const redis = app.get(RedisService);
  // 挂载会话中间件：必须在路由/守卫之前，登录态写入 req.session
  app.use(sessionMiddleware(config, () => redis.getClient()));

  // 创建请求 ID 中间件实例
  const requestId = new RequestIdMiddleware();
  // 注册请求 ID 中间件
  app.use((req: Request, res: Response, next: NextFunction) =>
    requestId.use(req, res, next),
  );
  // 注册 HTTP 日志中间件，使用 pino
  app.use(
    pinoHttp({
      // 脱敏字段列表：隐藏敏感信息
      redact: [
        'req.headers.authorization', // 授权头
        'req.headers.cookie', // Cookie 头
        'req.body.password', // 密码字段
        'req.body.currentPassword', // 当前密码字段
        'req.body.newPassword', // 新密码字段
      ],
      // 生成请求 ID：使用请求头中的 x-request-id
      genReqId: (req) => req.headers['x-request-id'] as string,
    }),
  );

  // 配置全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // 白名单模式：自动剥离未声明的属性
      forbidNonWhitelisted: true, // 禁止非白名单属性：存在额外属性时抛出异常
      transform: true, // 自动转换：将请求参数转换为 DTO 类型
    }),
  );
  // 设置全局 API 前缀
  app.setGlobalPrefix('api/v1');
  // 启用 CORS 跨域
  app.enableCors({ origin: config.corsOrigins, credentials: true });

  // 监听 3000 端口
  await app.listen(3000);
}

// 启动应用
void bootstrap();
