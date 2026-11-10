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
  it('邮箱与密码合法时校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
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
