import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gender, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Request } from 'express';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../redis/rate-limit.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

// 登录失败限流：每分钟允许的失败次数
const LOGIN_MAX_ATTEMPTS = 5;
// 登录失败限流窗口（秒）
const LOGIN_WINDOW_SEC = 60;
// 默认 bcrypt 成本因子（配置缺失时兜底，与 D10 的 cost≥12 一致）
const DEFAULT_BCRYPT_COST = 12;

// 登录响应：后续步骤只依赖角色
export interface LoginResult {
  role: UserRole; // 当前账号角色
}

// 注册响应：新用户 id
export interface RegisterResult {
  id: number; // 新用户唯一标识
}

// 当前用户资料：与 openapi User 一致（不含 passwordHash）
export interface UserProfile {
  id: number; // 用户 id
  email: string; // 邮箱（只读）
  nickname: string; // 昵称
  avatarUrl: string | null; // 头像 URL
  gender: Gender; // 性别
  role: UserRole; // 角色
  createdAt: Date; // 注册时间
}

// 判断错误是否为 Prisma 唯一约束冲突（P2002）
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

// 邮箱统一小写并去除首尾空白
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// 统一的登录失败提示（不泄露账号是否存在或 TOTP 状态）
function credentialsError(): BizException {
  return new BizException(ErrorCode.BAD_CREDENTIALS, '邮箱或密码错误', 401);
}

// 认证服务：注册/登录/登出/当前用户/改密
@Injectable()
export class AuthService {
  // 构造函数：注入数据库、会话、TOTP、限流与配置服务
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly totp: TotpService,
    private readonly rateLimit: RateLimitService,
    private readonly config: ConfigService,
  ) {}

  // 注册：不自动登录
  async register(dto: RegisterDto): Promise<RegisterResult> {
    // 两次密码一致（DTO 已校验，服务层兜底防止直接调用绕过）
    if (dto.password !== dto.confirmPassword) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '两次输入的密码不一致',
        400,
      );
    }
    // 统一小写存储
    const email = normalizeEmail(dto.email);
    try {
      // 创建用户，密码以 bcrypt 哈希存储
      const user = await this.prisma.user.create({
        data: {
          email,
          nickname: dto.nickname,
          passwordHash: await bcrypt.hash(dto.password, this.bcryptCost()),
        },
      });
      return { id: user.id };
    } catch (error) {
      // 邮箱唯一约束冲突
      if (isUniqueViolation(error)) {
        throw new BizException(ErrorCode.PARAM_INVALID, '该邮箱已注册', 409);
      }
      throw error;
    }
  }

  // 登录：校验密码与管理员 TOTP，成功后建立会话
  async login(dto: LoginDto, req: Request): Promise<LoginResult> {
    // 统一小写查询
    const email = normalizeEmail(dto.email);
    // 登录失败限流键：IP + 账号双维度
    const limitKeys = [`login:ip:${req.ip}`, `login:email:${email}`];

    // 按邮箱查询用户
    const user = await this.prisma.user.findUnique({ where: { email } });
    // 密码是否匹配（账号不存在时不执行 bcrypt 比对）
    const passwordMatched = user
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : false;
    // 账号可用且密码正确
    const credentialsOk = user?.status === 'active' && passwordMatched;

    // 密码错误或账号禁用：统一提示，并计入失败次数
    if (!credentialsOk || !user) {
      await this.rateLimit.penalize(
        limitKeys,
        LOGIN_MAX_ATTEMPTS,
        LOGIN_WINDOW_SEC,
      );
      throw credentialsError();
    }

    // 管理员强制 TOTP 二次验证（D8），缺码/错码与密码错误统一提示
    if (user.role === 'admin') {
      const totpOk =
        !!dto.totpCode &&
        !!user.totpSecret &&
        this.totp.verify(user.totpSecret, dto.totpCode);
      if (!totpOk) {
        await this.rateLimit.penalize(
          limitKeys,
          LOGIN_MAX_ATTEMPTS,
          LOGIN_WINDOW_SEC,
        );
        throw credentialsError();
      }
    }

    // 登录成功：重置失败计数并建立会话
    await this.rateLimit.clear(limitKeys);
    await this.sessions.establish(req, user.id, user.role);
    return { role: user.role };
  }

  // 登出：吊销当前会话
  async logout(req: Request): Promise<void> {
    await this.sessions.destroyCurrent(req);
  }

  // 当前用户资料（不含 passwordHash）
  async me(userId: number): Promise<UserProfile> {
    // 只取对外字段
    const profile = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nickname: true,
        avatarUrl: true,
        gender: true,
        role: true,
        createdAt: true,
      },
    });
    // 会话指向的用户已被删除
    if (!profile) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', 401);
    }
    return profile;
  }

  // 修改密码：成功后吊销该用户全部会话
  async changePassword(userId: number, dto: ChangePasswordDto): Promise<void> {
    // 两次新密码一致
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '两次输入的密码不一致',
        400,
      );
    }

    // 读取当前密码哈希
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    // 用户不存在
    if (!user) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '未登录', 401);
    }
    // 校验旧密码
    const currentOk = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentOk) {
      throw new BizException(ErrorCode.PARAM_INVALID, '当前密码不正确', 400);
    }

    // 写入新密码哈希
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(dto.newPassword, this.bcryptCost()),
      },
    });
    // 吊销全部会话，要求重新登录
    await this.sessions.destroyUserSessions(userId);
  }

  // 读取 bcrypt 成本因子
  private bcryptCost(): number {
    return this.config.get<number>('bcryptCost') ?? DEFAULT_BCRYPT_COST;
  }
}
