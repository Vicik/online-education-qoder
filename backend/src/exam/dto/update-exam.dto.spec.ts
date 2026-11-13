import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateExamDto } from './update-exam.dto';

// 构造编辑考试 DTO：默认只带版本号
function build(overrides: Partial<UpdateExamDto> = {}): UpdateExamDto {
  return plainToInstance(UpdateExamDto, { version: 1, ...overrides });
}

describe('UpdateExamDto', () => {
  it('只传版本号可通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('标题传空串或 null 被拒', async () => {
    await expect(validate(build({ title: '' }))).resolves.not.toHaveLength(0);
    await expect(
      validate(build({ title: null as unknown as string })),
    ).resolves.not.toHaveLength(0);
  });

  it('questionIds 传空数组被拒，不传可通过', async () => {
    await expect(
      validate(build({ questionIds: [] })),
    ).resolves.not.toHaveLength(0);
    await expect(validate(build())).resolves.toHaveLength(0);
  });
});
