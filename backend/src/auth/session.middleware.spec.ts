import { NextFunction, Request, Response } from 'express';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/configuration';
import { SESSION_KEY_PREFIX } from './session.constants';
import { sessionMiddleware } from './session.middleware';

// express-session 工厂替身：记录传入选项并返回可调用的处理器
const mockSessionFactory = jest.fn();
// connect-redis 存储替身：记录构造参数
const mockRedisStore = jest.fn();

jest.mock(
  'express-session',
  () => (options: unknown) => mockSessionFactory(options),
);
jest.mock('connect-redis', () => ({
  RedisStore: class {
    // 构造时记录选项，供断言
    constructor(options: unknown) {
      mockRedisStore(options);
    }
  },
}));

// 测试用配置
const config: AppConfig = {
  databaseUrl: 'postgres://x',
  redisUrl: 'redis://x',
  sessionSecret: 's3cret',
  sessionTtl: 86400,
  orderPendingTtlMinutes: 15,
  jobScanIntervalSeconds: 60,
  corsOrigins: [],
  bcryptCost: 12,
  seedDemoData: true,
  upload: {
    dir: 'uploadFiles',
    publicBaseUrl: 'http://localhost:3000',
    signingSecret: 's3cret',
    audioMaxBytes: 100 * 1024 * 1024,
    videoMaxBytes: 1024 * 1024 * 1024,
    mediaUrlTtlSec: 14400,
    xAccelPrefix: '',
  },
};

describe('sessionMiddleware', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  // 底层 Redis 客户端替身
  const client = {} as Redis;
  // 惰性取客户端
  const getClient = () => client;

  beforeEach(() => {
    mockSessionFactory.mockReset();
    mockRedisStore.mockReset();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('首次请求才构建处理器，之后复用同一实例', () => {
    // express-session 返回的处理器
    const handler = jest.fn();
    mockSessionFactory.mockReturnValue(handler);
    // 被测中间件
    const middleware = sessionMiddleware(config, getClient);
    // 假请求/响应
    const request = {} as Request;
    const response = {} as Response;
    const next = jest.fn() as NextFunction;

    expect(mockSessionFactory).not.toHaveBeenCalled();
    middleware(request, response, next);
    middleware(request, response, next);

    expect(mockSessionFactory).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(request, response, next);
  });

  it('Cookie 属性：HttpOnly + SameSite=Lax + 非生产不 Secure + TTL', () => {
    process.env.NODE_ENV = 'test';
    mockSessionFactory.mockReturnValue(jest.fn());
    // 执行一次请求触发构建
    sessionMiddleware(config, getClient)(
      {} as Request,
      {} as Response,
      jest.fn(),
    );

    // express-session 选项
    const options = mockSessionFactory.mock.calls[0][0] as {
      secret: string;
      resave: boolean;
      saveUninitialized: boolean;
      rolling: boolean;
      cookie: {
        httpOnly: boolean;
        secure: boolean;
        sameSite: string;
        maxAge: number;
      };
    };
    expect(options.secret).toBe('s3cret');
    expect(options.resave).toBe(false);
    expect(options.saveUninitialized).toBe(false);
    expect(options.rolling).toBe(true);
    expect(options.cookie).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 86400 * 1000,
    });
  });

  it('生产环境 Cookie 开启 Secure', () => {
    process.env.NODE_ENV = 'production';
    mockSessionFactory.mockReturnValue(jest.fn());
    sessionMiddleware(config, getClient)(
      {} as Request,
      {} as Response,
      jest.fn(),
    );

    // express-session 选项
    const options = mockSessionFactory.mock.calls[0][0] as {
      cookie: { secure: boolean };
    };
    expect(options.cookie.secure).toBe(true);
  });

  it('RedisStore 使用 sess: 前缀与惰性取得的客户端', () => {
    mockSessionFactory.mockReturnValue(jest.fn());
    sessionMiddleware(config, getClient)(
      {} as Request,
      {} as Response,
      jest.fn(),
    );

    expect(mockRedisStore).toHaveBeenCalledWith({
      client,
      prefix: SESSION_KEY_PREFIX,
      ttl: config.sessionTtl,
    });
  });
});
