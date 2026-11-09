import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

// Redis 释放锁 Lua 脚本：原子性地检查并删除锁，确保只释放自己持有的锁
const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

// Redis 服务：封装 ioredis 客户端，提供常用的 Redis 操作方法
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  // 日志记录器
  private readonly logger = new Logger(RedisService.name);
  // Redis 客户端实例
  private client!: Redis;

  // 构造函数：注入配置服务获取 Redis 连接 URL
  constructor(private readonly config: ConfigService) {}

  // 模块初始化钩子：创建并连接 Redis 客户端
  async onModuleInit(): Promise<void> {
    // 创建 Redis 客户端实例
    this.client = new Redis(this.config.get<string>('redisUrl') ?? '', {
      lazyConnect: true, // 延迟连接
      maxRetriesPerRequest: 2, // 每个请求最大重试次数
      enableOfflineQueue: false, // 禁用离线队列
    });
    // 监听错误事件
    this.client.on('error', (error: Error) => {
      this.logger.warn(`Redis 连接异常：${error.message}`);
    });
    // 依赖不可用时不能阻断启动，否则 /healthz 也起不来；就绪状态交给 /readyz
    try {
      // 尝试连接 Redis
      await this.client.connect();
    } catch (error) {
      // 连接失败时记录警告日志
      this.logger.warn(`Redis 首次建连失败：${(error as Error).message}`);
    }
  }

  // 模块销毁钩子：优雅关闭 Redis 连接
  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  // 获取底层 Redis 客户端：供会话存储等基础设施复用同一连接
  getClient(): Redis {
    return this.client;
  }

  // 获取键值
  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  // 设置键值，可选过期时间
  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    // 如果没有指定 TTL，直接设置
    if (ttlSec === undefined) await this.client.set(key, value);
    // 否则设置带过期时间的键
    else await this.client.set(key, value, 'EX', ttlSec);
  }

  // 删除键
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  // 递增计数器
  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  // 递减计数器
  decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  // 设置键的过期时间
  async expire(key: string, ttlSec: number): Promise<void> {
    await this.client.expire(key, ttlSec);
  }

  // 向集合添加成员
  sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  // 从集合移除成员
  srem(key: string, ...members: string[]): Promise<number> {
    return this.client.srem(key, ...members);
  }

  // 获取集合所有成员
  smembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  // 原子性设置：只在键不存在时设置，并指定过期时间
  async setNxEx(key: string, value: string, ttlSec: number): Promise<boolean> {
    // 执行 SET NX EX 命令
    const result = await this.client.set(key, value, 'EX', ttlSec, 'NX');
    // 返回是否设置成功
    return result === 'OK';
  }

  // 条件删除：只有当键的值匹配时才删除，用于安全释放分布式锁
  async delIfValue(key: string, value: string): Promise<void> {
    // 执行 Lua 脚本原子性地检查并删除
    await this.client.eval(RELEASE_SCRIPT, 1, key, value);
  }

  // 发送 PING 命令，用于健康检查
  ping(): Promise<string> {
    return this.client.ping();
  }
}
