import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { RedisService } from '../redis/redis.service';
import { SESSION_KEY_PREFIX, userSessionsKey } from './session.constants';
import './session.types'; // 引入 express-session 类型扩展（req.session.userId/role）

// 默认会话有效期（秒）：与配置默认值保持一致
const DEFAULT_SESSION_TTL = 86400;

// 会话服务：负责建立会话、登记在线会话集合以及单会话/全端吊销
@Injectable()
export class SessionService {
  // 构造函数：注入 Redis 服务与配置服务
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  // 登录成功：写入会话并登记 user_sessions:{userId} 集合
  async establish(req: Request, userId: number, role: UserRole): Promise<void> {
    // 先保存会话，确保 Redis 中已有 sess:{sessionId} 键
    await new Promise<void>((resolve, reject) => {
      req.session.userId = userId;
      req.session.role = role;
      req.session.save((error) => (error ? reject(error) : resolve()));
    });

    // 用户会话集合键
    const key = userSessionsKey(userId);
    // 登记本次会话 id，支持后续全端吊销
    await this.redis.sadd(key, req.sessionID);
    // 集合随会话一起过期，避免长期堆积
    await this.redis.expire(key, this.sessionTtl());
  }

  // 吊销当前会话（登出）
  async destroyCurrent(req: Request): Promise<void> {
    // 销毁前先取出用户 id 与 sessionId（destroy 后 req.session 不可用）
    const userId = req.session?.userId;
    // 当前会话 id
    const sessionId = req.sessionID;
    // 从存储中删除当前会话
    if (req.session) {
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((error) => (error ? reject(error) : resolve()));
      });
    }
    // 从用户会话集合移除
    if (userId) await this.redis.srem(userSessionsKey(userId), sessionId);
  }

  // 吊销某用户全部会话（改密后调用）
  async destroyUserSessions(userId: number): Promise<void> {
    // 用户会话集合键
    const key = userSessionsKey(userId);
    // 该用户全部在线会话 id
    const sessionIds = await this.redis.smembers(key);
    // 逐个删除会话键
    for (const sessionId of sessionIds) {
      await this.redis.del(`${SESSION_KEY_PREFIX}${sessionId}`);
    }
    // 删除集合本身
    await this.redis.del(key);
  }

  // 读取会话有效期（秒）
  private sessionTtl(): number {
    return this.config.get<number>('sessionTtl') ?? DEFAULT_SESSION_TTL;
  }
}
