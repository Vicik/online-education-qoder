import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

// 构造资料 DTO：默认昵称与性别合法
function build(overrides: Partial<UpdateProfileDto> = {}): UpdateProfileDto {
  return plainToInstance(UpdateProfileDto, {
    nickname: '小知',
    gender: 'male',
    ...overrides,
  });
}

describe('UpdateProfileDto', () => {
  it('合法参数校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('昵称缺失或为空串被拒', async () => {
    await expect(
      validate(plainToInstance(UpdateProfileDto, { gender: 'male' })),
    ).resolves.not.toHaveLength(0);
    await expect(validate(build({ nickname: '' }))).resolves.not.toHaveLength(
      0,
    );
  });

  it('头像可以传 null 清空', async () => {
    await expect(validate(build({ avatarUrl: null }))).resolves.toHaveLength(0);
  });
});
