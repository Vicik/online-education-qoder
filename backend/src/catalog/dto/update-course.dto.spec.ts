import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCourseDto } from './update-course.dto';

// 构造编辑课程 DTO：可覆盖任意字段，仅 version 为默认必填项
function build(overrides: Record<string, unknown> = {}): UpdateCourseDto {
  return plainToInstance(UpdateCourseDto, {
    version: 1, // 乐观锁版本
    ...overrides,
  });
}

describe('UpdateCourseDto', () => {
  it('只传 version 时校验通过（部分更新）', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('传入合法讲师与封面时校验通过', async () => {
    await expect(
      validate(
        build({
          instructor: '王老师',
          coverUrl: 'image/2026/11/12/cover.png',
        }),
      ),
    ).resolves.toHaveLength(0);
  });

  it('讲师为 null 或空串被拒', async () => {
    await expect(validate(build({ instructor: null }))).resolves.not.toHaveLength(
      0,
    );
    await expect(validate(build({ instructor: '' }))).resolves.not.toHaveLength(0);
  });

  it('封面为 null 或空串被拒', async () => {
    await expect(validate(build({ coverUrl: null }))).resolves.not.toHaveLength(0);
    await expect(validate(build({ coverUrl: '' }))).resolves.not.toHaveLength(0);
  });
});
