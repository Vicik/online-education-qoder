import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';

// TOTP 窗口：允许前后各 1 个时间步（±30 秒），容忍客户端时钟偏差
const TOTP_WINDOW = 1;

// TOTP 校验结果类型：otplib 的 verify 返回布尔值
type TotpVerifier = ReturnType<typeof authenticator.clone>;

// TOTP 服务：管理员二次验证的密钥签发与动态码校验（D8）
@Injectable()
export class TotpService {
  // 限定了 ±1 时间窗的验证器实例
  private readonly verifier: TotpVerifier = authenticator.clone({
    window: TOTP_WINDOW,
  });

  // 构造函数：注入 Prisma 服务
  constructor(private readonly prisma: PrismaService) {}

  // 为用户生成密钥并落库；返回 otpauth:// URI（admin 初始化时展示一次）
  async issueSecret(
    userId: number,
  ): Promise<{ secret: string; otpauthUri: string }> {
    // 读取用户邮箱用于 URI 账号标识（不存在则抛错）
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    // 随机 Base32 密钥
    const secret = this.verifier.generateSecret();
    // 写入用户记录
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret },
    });
    // 供验证器扫码绑定的 URI（发行方：知序课堂）
    const otpauthUri = this.verifier.keyuri(user.email, '知序课堂', secret);
    return { secret, otpauthUri };
  }

  // 校验 TOTP 动态码（窗口 ±1）
  verify(secret: string, code: string): boolean {
    return this.verifier.verify({ token: code, secret });
  }
}
