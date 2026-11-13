import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from './change-password.dto';

// 构造改密 DTO：可覆盖任意字段，未覆盖的字段使用默认合法值
function build(overrides: Partial<ChangePasswordDto> = {}): ChangePasswordDto {
  return plainToInstance(ChangePasswordDto, {
    currentPassword: 'OldPassw0rd', // 旧密码（服务层校验正确性）
    newPassword: 'NewPassw0rd2', // 合法新密码
    confirmPassword: 'NewPassw0rd2', // 与新密码一致
    ...overrides,
  });
}

describe('ChangePasswordDto', () => {
  it('合法参数校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('新密码 7 位报错', async () => {
    const dto = build({ newPassword: 'abc1234', confirmPassword: 'abc1234' });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('两次新密码不一致报错', async () => {
    const dto = build({ confirmPassword: 'NewPassw0rd3' });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('旧密码缺失报错', async () => {
    await expect(
      validate(
        plainToInstance(ChangePasswordDto, { newPassword: 'NewPassw0rd2' }),
      ),
    ).resolves.not.toHaveLength(0);
  });

  it('必填字段为空串被拒', async () => {
    await expect(
      validate(build({ currentPassword: '' })),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(build({ newPassword: '', confirmPassword: '' })),
    ).resolves.not.toHaveLength(0);
  });
});
