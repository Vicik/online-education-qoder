import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

// 构造注册 DTO：可覆盖任意字段，未覆盖的字段使用默认合法值
function build(overrides: Partial<RegisterDto> = {}): RegisterDto {
  return plainToInstance(RegisterDto, {
    email: 'a@b.com', // 合法邮箱
    password: 'Passw0rd1', // 合法密码
    confirmPassword: 'Passw0rd1', // 与密码一致
    nickname: '小知', // 合法昵称
    ...overrides,
  });
}

describe('RegisterDto', () => {
  it('合法参数校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('密码 7 位报错；密码 64 位通过', async () => {
    // 7 位密码（少于 8 位）
    const shortPassword = build({
      password: 'abc1234',
      confirmPassword: 'abc1234',
    });
    await expect(validate(shortPassword)).resolves.not.toHaveLength(0);

    // 64 位密码（边界值，含字母与数字）
    const longPassword = 'a'.repeat(63) + '1';
    const maxPassword = build({
      password: longPassword,
      confirmPassword: longPassword,
    });
    await expect(validate(maxPassword)).resolves.toHaveLength(0);
  });

  it('密码缺少数字或字母时报错', async () => {
    // 纯字母密码
    const lettersOnly = build({
      password: 'abcdefgh',
      confirmPassword: 'abcdefgh',
    });
    await expect(validate(lettersOnly)).resolves.not.toHaveLength(0);

    // 纯数字密码
    const digitsOnly = build({
      password: '12345678',
      confirmPassword: '12345678',
    });
    await expect(validate(digitsOnly)).resolves.not.toHaveLength(0);
  });

  it('两次密码不一致报错', async () => {
    const dto = build({ confirmPassword: 'Passw0rd2' });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('昵称超 30 字符报错', async () => {
    const dto = build({ nickname: '书'.repeat(31) });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('邮箱格式错误报错', async () => {
    const dto = build({ email: 'not-an-email' });
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('必填字段为空串被拒', async () => {
    for (const override of [
      { email: '' },
      { password: '', confirmPassword: '' },
      { confirmPassword: '' },
      { nickname: '' },
    ]) {
      await expect(validate(build(override))).resolves.not.toHaveLength(0);
    }
  });
});
