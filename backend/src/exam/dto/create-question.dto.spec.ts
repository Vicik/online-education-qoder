import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateQuestionDto } from './create-question.dto';

// 构造题目 DTO：默认合法单选
function build(overrides: Partial<CreateQuestionDto> = {}): CreateQuestionDto {
  return plainToInstance(CreateQuestionDto, {
    type: 'single',
    stem: '1+1=?',
    options: [
      { key: 'A', text: '2' },
      { key: 'B', text: '3' },
    ],
    answer: ['A'],
    analysis: '显然',
    score: 5,
    ...overrides,
  });
}

describe('CreateQuestionDto', () => {
  it('合法参数校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('解析缺失或为空串被拒', async () => {
    await expect(validate(build({ analysis: '' }))).resolves.not.toHaveLength(
      0,
    );
    await expect(
      validate(
        plainToInstance(CreateQuestionDto, {
          type: 'single',
          stem: '1+1=?',
          options: [
            { key: 'A', text: '2' },
            { key: 'B', text: '3' },
          ],
          answer: ['A'],
          score: 5,
        }),
      ),
    ).resolves.not.toHaveLength(0);
  });

  it('答案元素不得为空串', async () => {
    await expect(validate(build({ answer: [''] }))).resolves.not.toHaveLength(
      0,
    );
    await expect(
      validate(build({ answer: ['A', ''] })),
    ).resolves.not.toHaveLength(0);
  });
});
