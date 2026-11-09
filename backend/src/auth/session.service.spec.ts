import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UserRole } from '@prisma/client';
import { FakeRedis } from '../../test/utils/fake-redis';
import { RedisService } from '../redis/redis.service';
import { SESSION_KEY_PREFIX, userSessionsKey } from './session.constants';
import { SessionService } from './session.service';

// 测试用会话对象：记录 save/destroy 调用并可注入回调错误
interface FakeSession {
  userId?: number; // 会话中的用户 id
  role?: UserRole; // 会话中的角色
  save: jest.Mock; // 保存回调
  destroy: jest.Mock; // 销毁回调
}

// 构建测试环境：内存 Redis + 固定 TTL 的配置
function setup() {
  // 内存 Redis 替身
  const redis = new FakeRedis();
  // 配置替身：只关心会话 TTL
  const config = {
    get: jest.fn((key: string) => (key === 'sessionTtl' ? 3600 : undefined)),
  };
  // 被测服务
  const service = new SessionService(
    redis as unknown as RedisService,
    config as unknown as ConfigService,
  );
  return { redis, service };
}

// 构造带会话的假请求
function fakeRequest(session: FakeSession, sessionID = 'sid-1'): Request {
  return { session, sessionID } as unknown as Request;
}

// 构造可正常保存/销毁的会话
function okSession(): FakeSession {
  return {
    save: jest.fn((callback: (error?: unknown) => void) => callback()),
    destroy: jest.fn((callback: (error?: unknown) => void) => callback()),
  };
}

describe('SessionService', () => {
  describe('establish', () => {
    it('写入 userId/role，保存会话并登记到用户会话集合', async () => {
      const { redis, service } = setup();
      // 待写入的会话
      const session = okSession();
      // 假请求
      const request = fakeRequest(session);

      await service.establish(request, 7, 'user');

      expect(session.userId).toBe(7);
      expect(session.role).toBe('user');
      expect(session.save).toHaveBeenCalledTimes(1);
      expect(await redis.smembers(userSessionsKey(7))).toEqual(['sid-1']);
      expect(redis.expiries.get(userSessionsKey(7))).toBe(3600);
    });

    it('会话保存失败时抛出异常且不登记', async () => {
      const { redis, service } = setup();
      // 保存时返回错误的会话
      const session: FakeSession = {
        save: jest.fn((callback: (error?: unknown) => void) =>
          callback(new Error('save failed')),
        ),
        destroy: jest.fn(),
      };

      await expect(
        service.establish(fakeRequest(session), 7, 'user'),
      ).rejects.toThrow('save failed');
      expect(await redis.smembers(userSessionsKey(7))).toEqual([]);
    });
  });

  describe('destroyCurrent', () => {
    it('销毁当前会话并从用户会话集合移除', async () => {
      const { redis, service } = setup();
      // 预先登记当前会话
      await redis.sadd(userSessionsKey(7), 'sid-1');
      // 会话对象
      const session = okSession();
      session.userId = 7;

      await service.destroyCurrent(fakeRequest(session));

      expect(session.destroy).toHaveBeenCalledTimes(1);
      expect(await redis.smembers(userSessionsKey(7))).toEqual([]);
    });

    it('无 userId 时仍销毁会话且不报错', async () => {
      const { service } = setup();
      // 未登录的空会话
      const session = okSession();

      await expect(
        service.destroyCurrent(fakeRequest(session)),
      ).resolves.toBeUndefined();
      expect(session.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroyUserSessions', () => {
    it('删除该用户全部 sess 键与集合本身', async () => {
      const { redis, service } = setup();
      // 两个在线会话
      await redis.sadd(userSessionsKey(7), 'a', 'b');
      // 对应的 Redis 会话键
      await redis.set(`${SESSION_KEY_PREFIX}a`, 'data-a');
      await redis.set(`${SESSION_KEY_PREFIX}b`, 'data-b');

      await service.destroyUserSessions(7);

      expect(redis.store.has(`${SESSION_KEY_PREFIX}a`)).toBe(false);
      expect(redis.store.has(`${SESSION_KEY_PREFIX}b`)).toBe(false);
      expect(await redis.smembers(userSessionsKey(7))).toEqual([]);
    });

    it('用户没有在线会话时幂等返回', async () => {
      const { service } = setup();
      await expect(service.destroyUserSessions(99)).resolves.toBeUndefined();
    });
  });
});
