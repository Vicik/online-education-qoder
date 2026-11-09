import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { TotpService } from './totp.service';

// 测试用邮箱
const EMAIL = 'admin@example.com';

// 构建带假 Prisma 的 TOTP 服务
function setup() {
  // Prisma 替身
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ email: EMAIL }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  // 被测服务
  const service = new TotpService(prisma as unknown as PrismaService);
  return { prisma, service };
}

describe('TotpService', () => {
  it('签发密钥：落库并返回 otpauth URI', async () => {
    const { prisma, service } = setup();

    const result = await service.issueSecret(1);

    // 密钥为 Base32 字符串
    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    // URI 含发行方与账号
    expect(result.otpauthUri).toContain('otpauth://totp/');
    expect(result.otpauthUri).toContain(encodeURIComponent(EMAIL));
    expect(result.otpauthUri).toContain(`secret=${result.secret}`);
    // 密钥已写入数据库
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { totpSecret: result.secret },
    });
  });

  it('用户不存在时签发失败', async () => {
    const { prisma, service } = setup();
    prisma.user.findUniqueOrThrow.mockRejectedValue(new Error('not found'));

    await expect(service.issueSecret(99)).rejects.toThrow('not found');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('校验当前时间窗口内的动态码通过', () => {
    const { service } = setup();
    // 合法 Base32 密钥
    const secret = authenticator.generateSecret();

    expect(service.verify(secret, authenticator.generate(secret))).toBe(true);
  });

  it('错误动态码不通过', () => {
    const { service } = setup();
    const secret = authenticator.generateSecret();

    expect(service.verify(secret, '000000')).toBe(false);
  });
});
