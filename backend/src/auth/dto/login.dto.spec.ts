import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

// 构造登录 DTO：可覆盖任意字段，未覆盖的字段使用默认合法值
function build(overrides: Partial<LoginDto> = {}): LoginDto {
  return plainToInstance(LoginDto, {
    email: 'a@b.com', // 合法邮箱
    password: 'Passw0rd1', // 任意非空密码
    ...overrides,
  });
}

describe('LoginDto', () => {
  it('不传 totpCode 时校验通过（普通用户）', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('totpCode 为 6 位数字时通过', async () => {
    await expect(validate(build({ totpCode: '123456' }))).resolves.toHaveLength(
      0,
    );
  });

  it('totpCode 位数不足或含非数字时报错', async () => {
    await expect(
      validate(build({ totpCode: '12345' })),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(build({ totpCode: '12345a' })),
    ).resolves.not.toHaveLength(0);
  });

  it('邮箱或密码类型错误报错', async () => {
    await expect(validate(build({ email: 'bad' }))).resolves.not.toHaveLength(
      0,
    );
    // 密码缺失
    await expect(
      validate(plainToInstance(LoginDto, { email: 'a@b.com' })),
    ).resolves.not.toHaveLength(0);
  });
});
