import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateExamDto } from './create-exam.dto';

// 构造考试 DTO：默认标题与组卷合法
function build(overrides: Partial<CreateExamDto> = {}): CreateExamDto {
  return plainToInstance(CreateExamDto, {
    title: '期中测验',
    durationMin: 30,
    passScore: 10,
    questionIds: [1, 2],
    ...overrides,
  });
}

describe('CreateExamDto', () => {
  it('合法参数校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('标题为空串被拒', async () => {
    await expect(validate(build({ title: '' }))).resolves.not.toHaveLength(0);
  });

  it('题目 id 为空数组被拒', async () => {
    await expect(
      validate(build({ questionIds: [] })),
    ).resolves.not.toHaveLength(0);
  });
});
