/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging -- 有意合并：消费方按 PrismaClient 类型使用本服务，客户端实际懒加载 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// 绑定 this 上下文：确保函数调用时 this 指向正确的对象
function bindThis<T>(value: unknown, thisArg: T): unknown {
  // 如果是函数则绑定 this，否则直接返回
  return typeof value === 'function' ? value.bind(thisArg) : value;
}

// Nest 启动期会探测的实例属性集合：这些属性访问时返回 undefined，避免触发客户端实例化
const NEST_PROBE_PROPS = new Set([
  'then', // Promise 探测
  'onApplicationBootstrap', // 应用启动钩子
  'beforeApplicationShutdown', // 关闭前钩子
  'onApplicationShutdown', // 关闭钩子
]);

// Prisma 服务：封装 PrismaClient，支持懒加载和优雅关闭
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  // 日志记录器
  private readonly logger = new Logger(PrismaService.name);
  // Prisma 客户端实例，初始为 null
  private client: PrismaClient | null = null;

  // 构造函数：使用 Proxy 实现懒实例化
  constructor() {
    // 返回代理对象，延迟客户端的创建
    return new Proxy(this, {
      // 属性访问拦截器
      get: (target, prop, receiver) => {
        // Nest 探测属性返回 undefined，避免触发实例化
        if (typeof prop === 'symbol' || NEST_PROBE_PROPS.has(prop)) {
          return undefined;
        }
        // 如果属性在 target 上存在，返回绑定 this 的值
        if (prop in target) {
          return bindThis(Reflect.get(target, prop, receiver), target);
        }
        // 否则确保客户端已创建，并从客户端获取属性
        const client = target.ensureClient();
        return bindThis(Reflect.get(client, prop, client), client);
      },
    });
  }

  // 确保客户端已创建：首次调用时实例化 PrismaClient
  private ensureClient(): PrismaClient {
    // 使用空值合并赋值运算符，只在 null 时创建
    this.client ??= new PrismaClient();
    // 返回客户端实例
    return this.client;
  }

  // 模块初始化钩子：尝试连接数据库
  async onModuleInit(): Promise<void> {
    // 依赖不可用时不能阻断启动，否则 /healthz 也起不来；就绪状态交给 /readyz
    try {
      // 创建 Prisma 客户端实例
      this.client = new PrismaClient();
      // 尝试连接数据库
      await this.client.$connect();
    } catch (error) {
      // 连接失败时记录警告日志，不阻断启动
      this.logger.warn(`数据库首次建连失败：${(error as Error).message}`);
    }
  }

  // 模块销毁钩子：断开数据库连接
  async onModuleDestroy(): Promise<void> {
    // 如果客户端存在则断开连接
    await this.client?.$disconnect();
  }
}

// 类型合并声明：让 PrismaService 同时具有 PrismaClient 的类型
export interface PrismaService extends PrismaClient {}
