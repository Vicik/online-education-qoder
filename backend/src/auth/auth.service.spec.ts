import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as bcrypt from 'bcrypt';
import { BizException } from '../common/exceptions/biz.exception';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../redis/rate-limit.service';
import { StorageService } from '../storage/storage.service';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

// 测试用户邮箱
const EMAIL = 'User@Example.com';
// 测试用户明文密码
const PASSWORD = 'Passw0rd1';
// 测试用 bcrypt 成本（最低值，加快单测）
const BCRYPT_COST = 4;

// 构建被测服务及全部替身
async function setup() {
  // 预生成的密码哈希
  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_COST);
  // Prisma 替身
  const prisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  // 会话服务替身
  const sessions = {
    establish: jest.fn().mockResolvedValue(undefined),
    destroyCurrent: jest.fn().mockResolvedValue(undefined),
    destroyUserSessions: jest.fn().mockResolvedValue(undefined),
  };
  // TOTP 服务替身
  const totp = {
    verify: jest.fn().mockReturnValue(true),
    issueSecret: jest.fn(),
  };
  // 限流服务替身
  const rateLimit = {
    check: jest.fn().mockResolvedValue(undefined),
    penalize: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  // 配置替身：bcrypt 成本
  const config = {
    get: jest.fn((key: string) =>
      key === 'bcryptCost' ? BCRYPT_COST : undefined,
    ),
  };
  // 存储替身：key 签名、http 原样
  const storage = {
    resolveUrl: jest.fn(async (value: string | null) =>
      value === null
        ? null
        : /^https?:/i.test(value)
          ? value
          : `https://signed/${value}`,
    ),
  };
  // 被测服务
  const service = new AuthService(
    prisma as unknown as PrismaService,
    sessions as unknown as SessionService,
    totp as unknown as TotpService,
    rateLimit as unknown as RateLimitService,
    config as unknown as ConfigService,
    storage as unknown as StorageService,
  );
  return {
    prisma,
    sessions,
    totp,
    rateLimit,
    storage,
    service,
    passwordHash,
  };
}

// 构造假请求（IP + 会话）
function fakeRequest(): Request {
  return {
    ip: '127.0.0.1',
    session: {},
    sessionID: 'sid-1',
  } as unknown as Request;
}

// 构造登录 DTO
function loginDto(overrides: Record<string, unknown> = {}) {
  return { email: EMAIL, password: PASSWORD, ...overrides };
}

describe('AuthService', () => {
  describe('register', () => {
    it('两次密码不一致抛 1001', async () => {
      const { prisma, service } = await setup();

      await expect(
        service.register({
          email: EMAIL,
          password: PASSWORD,
          confirmPassword: 'Other1234',
          nickname: '小知',
        }),
      ).rejects.toMatchObject({ bizCode: 1001 });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('邮箱已存在（P2002）抛 1001/409', async () => {
      const { prisma, service } = await setup();
      // Prisma 唯一约束冲突
      prisma.user.create.mockRejectedValue({ code: 'P2002' });

      const error = await service
        .register({
          email: EMAIL,
          password: PASSWORD,
          confirmPassword: PASSWORD,
          nickname: '小知',
        })
        .catch((e: BizException) => e);

      expect(error).toBeInstanceOf(BizException);
      expect((error as BizException).bizCode).toBe(1001);
      expect((error as BizException).getStatus()).toBe(409);
    });

    it('成功注册：邮箱小写存储、密码哈希、返回 id', async () => {
      const { prisma, service } = await setup();
      prisma.user.create.mockResolvedValue({ id: 12 });

      const result = await service.register({
        email: '  User@Example.COM ',
        password: PASSWORD,
        confirmPassword: PASSWORD,
        nickname: '小知',
      });

      expect(result).toEqual({ id: 12 });
      // 写入参数
      const args = prisma.user.create.mock.calls[0][0] as {
        data: { email: string; nickname: string; passwordHash: string };
      };
      expect(args.data.email).toBe('user@example.com');
      expect(args.data.nickname).toBe('小知');
      // 密码以哈希形式存储
      expect(args.data.passwordHash).not.toBe(PASSWORD);
      await expect(
        bcrypt.compare(PASSWORD, args.data.passwordHash),
      ).resolves.toBe(true);
    });
  });

  describe('login', () => {
    it('账号不存在：统一提示 2003 且计入失败次数', async () => {
      const { prisma, rateLimit, sessions, service } = await setup();
      prisma.user.findUnique.mockResolvedValue(null);

      const error = await service
        .login(loginDto({ email: 'ghost@example.com' }), fakeRequest())
        .catch((e: BizException) => e);

      expect((error as BizException).bizCode).toBe(2003);
      expect((error as BizException).message).toBe('邮箱或密码错误');
      expect(rateLimit.penalize).toHaveBeenCalledWith(
        ['login:ip:127.0.0.1', 'login:email:ghost@example.com'],
        5,
        60,
      );
      expect(sessions.establish).not.toHaveBeenCalled();
    });

    it('密码错误：统一提示 2003', async () => {
      const { prisma, rateLimit, sessions, service, passwordHash } =
        await setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        passwordHash,
        role: 'user',
        status: 'active',
      });

      const error = await service
        .login(loginDto({ password: 'Wrong1234' }), fakeRequest())
        .catch((e: BizException) => e);

      expect((error as BizException).bizCode).toBe(2003);
      expect(rateLimit.penalize).toHaveBeenCalled();
      expect(sessions.establish).not.toHaveBeenCalled();
    });

    it('账号被禁用：统一提示 2003', async () => {
      const { prisma, sessions, service, passwordHash } = await setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        passwordHash,
        role: 'user',
        status: 'disabled',
      });

      await expect(
        service.login(loginDto(), fakeRequest()),
      ).rejects.toMatchObject({ bizCode: 2003 });
      expect(sessions.establish).not.toHaveBeenCalled();
    });

    it('限流超限时抛 429', async () => {
      const { prisma, rateLimit, service, passwordHash } = await setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        passwordHash,
        role: 'user',
        status: 'active',
      });
      // 第 6 次失败由限流服务抛 429
      rateLimit.penalize.mockRejectedValue(
        new BizException(1005, '请求过于频繁，请稍后再试', 429),
      );

      const error = await service
        .login(loginDto({ password: 'Wrong1234' }), fakeRequest())
        .catch((e: BizException) => e);

      expect(error).toBeInstanceOf(BizException);
      expect((error as BizException).bizCode).toBe(1005);
      expect((error as BizException).getStatus()).toBe(429);
    });

    it('普通用户登录成功：建立会话、清空失败计数并返回角色', async () => {
      const { prisma, sessions, rateLimit, service, passwordHash } =
        await setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        passwordHash,
        role: 'user',
        status: 'active',
      });
      // 假请求
      const request = fakeRequest();

      await expect(service.login(loginDto(), request)).resolves.toEqual({
        role: 'user',
      });
      expect(sessions.establish).toHaveBeenCalledWith(request, 1, 'user');
      expect(rateLimit.clear).toHaveBeenCalledWith([
        'login:ip:127.0.0.1',
        'login:email:user@example.com',
      ]);
    });

    it('管理员缺少动态码：统一提示 2003', async () => {
      const { prisma, totp, sessions, service, passwordHash } = await setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'admin@example.com',
        passwordHash,
        role: 'admin',
        status: 'active',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      });

      await expect(
        service.login(loginDto({ email: 'admin@example.com' }), fakeRequest()),
      ).rejects.toMatchObject({ bizCode: 2003 });
      expect(totp.verify).not.toHaveBeenCalled();
      expect(sessions.establish).not.toHaveBeenCalled();
    });

    it('管理员动态码错误：统一提示 2003', async () => {
      const { prisma, totp, sessions, service, passwordHash } = await setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'admin@example.com',
        passwordHash,
        role: 'admin',
        status: 'active',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      });
      totp.verify.mockReturnValue(false);

      await expect(
        service.login(
          loginDto({ email: 'admin@example.com', totpCode: '000000' }),
          fakeRequest(),
        ),
      ).rejects.toMatchObject({ bizCode: 2003 });
      expect(sessions.establish).not.toHaveBeenCalled();
    });

    it('管理员动态码正确：登录成功返回 admin', async () => {
      const { prisma, totp, sessions, service, passwordHash } = await setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 2,
        email: 'admin@example.com',
        passwordHash,
        role: 'admin',
        status: 'active',
        totpSecret: 'JBSWY3DPEHPK3PXP',
      });

      await expect(
        service.login(
          loginDto({ email: 'admin@example.com', totpCode: '123456' }),
          fakeRequest(),
        ),
      ).resolves.toEqual({ role: 'admin' });
      expect(totp.verify).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP', '123456');
      expect(sessions.establish).toHaveBeenCalledWith(
        expect.anything(),
        2,
        'admin',
      );
    });
  });

  describe('logout', () => {
    it('委托会话服务吊销当前会话', async () => {
      const { sessions, service } = await setup();
      // 假请求
      const request = fakeRequest();

      await service.logout(request);

      expect(sessions.destroyCurrent).toHaveBeenCalledWith(request);
    });
  });

  describe('me', () => {
    it('返回不含 passwordHash 的资料，头像读取时签名', async () => {
      const { prisma, service } = await setup();
      // 数据库返回的资料（avatarUrl 存对象存储 key）
      const profile = {
        id: 1,
        email: 'user@example.com',
        nickname: '小知',
        avatarUrl: 'zhixu/avatars/u1.png',
        gender: 'secret',
        role: 'user',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      };
      prisma.user.findUnique.mockResolvedValue(profile);

      await expect(service.me(1)).resolves.toEqual({
        ...profile,
        avatarKey: 'zhixu/avatars/u1.png',
        avatarUrl: 'https://signed/zhixu/avatars/u1.png',
      });
      // 查询使用 select，避免带出密码哈希
      const args = prisma.user.findUnique.mock.calls[0][0] as {
        select: Record<string, boolean>;
      };
      expect(args.select).toMatchObject({ id: true, email: true, role: true });
      expect(args.select.passwordHash).toBeUndefined();
    });

    it('历史 http 头像原样返回且 avatarKey 为 null', async () => {
      const { prisma, service } = await setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        nickname: '小知',
        avatarUrl: 'https://cdn.example.com/a.png',
        gender: 'secret',
        role: 'user',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });

      await expect(service.me(1)).resolves.toMatchObject({
        avatarKey: null,
        avatarUrl: 'https://cdn.example.com/a.png',
      });
    });

    it('用户不存在时抛 2001', async () => {
      const { prisma, service } = await setup();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.me(99)).rejects.toMatchObject({ bizCode: 2001 });
    });
  });

  describe('changePassword', () => {
    it('两次新密码不一致抛 1001', async () => {
      const { service } = await setup();

      await expect(
        service.changePassword(1, {
          currentPassword: PASSWORD,
          newPassword: 'NewPassw0rd2',
          confirmPassword: 'NewPassw0rd3',
        }),
      ).rejects.toMatchObject({ bizCode: 1001 });
    });

    it('当前密码错误抛 1001/400', async () => {
      const { prisma, sessions, service, passwordHash } = await setup();
      prisma.user.findUnique.mockResolvedValue({ passwordHash });

      const error = await service
        .changePassword(1, {
          currentPassword: 'Wrong1234',
          newPassword: 'NewPassw0rd2',
          confirmPassword: 'NewPassw0rd2',
        })
        .catch((e: BizException) => e);

      expect((error as BizException).bizCode).toBe(1001);
      expect((error as BizException).getStatus()).toBe(400);
      expect(sessions.destroyUserSessions).not.toHaveBeenCalled();
    });

    it('成功改密：写入新哈希并吊销全部会话', async () => {
      const { prisma, sessions, service, passwordHash } = await setup();
      prisma.user.findUnique.mockResolvedValue({ passwordHash });
      prisma.user.update.mockResolvedValue({});

      await service.changePassword(1, {
        currentPassword: PASSWORD,
        newPassword: 'NewPassw0rd2',
        confirmPassword: 'NewPassw0rd2',
      });

      // 写入新密码哈希
      const args = prisma.user.update.mock.calls[0][0] as {
        where: { id: number };
        data: { passwordHash: string };
      };
      expect(args.where).toEqual({ id: 1 });
      expect(args.data.passwordHash).not.toBe('NewPassw0rd2');
      await expect(
        bcrypt.compare('NewPassw0rd2', args.data.passwordHash),
      ).resolves.toBe(true);
      // 全部会话已吊销
      expect(sessions.destroyUserSessions).toHaveBeenCalledWith(1);
    });

    it('用户不存在时抛 2001', async () => {
      const { prisma, service } = await setup();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePassword(99, {
          currentPassword: PASSWORD,
          newPassword: 'NewPassw0rd2',
          confirmPassword: 'NewPassw0rd2',
        }),
      ).rejects.toMatchObject({ bizCode: 2001 });
    });
  });
});
