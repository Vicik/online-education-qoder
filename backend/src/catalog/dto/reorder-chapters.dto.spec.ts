import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReorderChaptersDto } from './reorder-chapters.dto';

// 构造排序 DTO：默认两个章节 id
function build(
  overrides: Partial<ReorderChaptersDto> = {},
): ReorderChaptersDto {
  return plainToInstance(ReorderChaptersDto, {
    orderedChapterIds: [1, 2],
    ...overrides,
  });
}

describe('ReorderChaptersDto', () => {
  it('合法参数校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('空数组被拒', async () => {
    await expect(
      validate(build({ orderedChapterIds: [] })),
    ).resolves.not.toHaveLength(0);
  });

  it('重复 id 被拒', async () => {
    await expect(
      validate(build({ orderedChapterIds: [1, 1] })),
    ).resolves.not.toHaveLength(0);
  });
});
