import { CourseType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCourseDto } from './create-course.dto';

// 构造创建课程 DTO：可覆盖任意字段，未覆盖的字段使用合法值
function build(overrides: Record<string, unknown> = {}): CreateCourseDto {
  return plainToInstance(CreateCourseDto, {
    name: 'TypeScript 入门', // 课程名称
    type: CourseType.video, // 视频课
    originalCents: 9900, // 原价（分）
    saleCents: 4900, // 售价（分）
    instructor: '张老师', // 讲师
    coverUrl: 'image/2026/11/12/cover.png', // 封面 key
    ...overrides,
  });
}

describe('CreateCourseDto', () => {
  it('必填字段齐全时校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('课程名称为空串被拒', async () => {
    await expect(validate(build({ name: '' }))).resolves.not.toHaveLength(0);
  });

  it('缺少讲师被拒', async () => {
    await expect(
      validate(
        build({
          instructor: undefined,
        }),
      ),
    ).resolves.not.toHaveLength(0);
  });

  it('讲师为空串被拒', async () => {
    await expect(validate(build({ instructor: '' }))).resolves.not.toHaveLength(
      0,
    );
  });

  it('缺少封面被拒', async () => {
    await expect(
      validate(
        build({
          coverUrl: undefined,
        }),
      ),
    ).resolves.not.toHaveLength(0);
  });

  it('封面为空串被拒', async () => {
    await expect(validate(build({ coverUrl: '' }))).resolves.not.toHaveLength(0);
  });
});
