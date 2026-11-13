import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateQuestionDto } from './update-question.dto';

// 构造编辑题目 DTO：默认只带版本号
function build(overrides: Partial<UpdateQuestionDto> = {}): UpdateQuestionDto {
  return plainToInstance(UpdateQuestionDto, { version: 1, ...overrides });
}

describe('UpdateQuestionDto', () => {
  it('只传版本号可通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('题干或解析传空串、null 被拒', async () => {
    for (const override of [
      { stem: '' },
      { stem: null as unknown as string },
      { analysis: '' },
      { analysis: null as unknown as string },
    ]) {
      await expect(validate(build(override))).resolves.not.toHaveLength(0);
    }
  });

  it('答案传空数组或空串元素被拒', async () => {
    await expect(validate(build({ answer: [] }))).resolves.not.toHaveLength(0);
    await expect(validate(build({ answer: [''] }))).resolves.not.toHaveLength(
      0,
    );
  });
});
