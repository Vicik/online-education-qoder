import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateChapterDto } from './update-chapter.dto';

// 构造编辑章节 DTO：可覆盖任意字段，默认不传任何可编辑字段
function build(overrides: Record<string, unknown> = {}): UpdateChapterDto {
  return plainToInstance(UpdateChapterDto, { ...overrides });
}

describe('UpdateChapterDto', () => {
  it('不传字段时校验通过（部分更新）', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('传入合法标题时校验通过', async () => {
    await expect(validate(build({ title: '新标题' }))).resolves.toHaveLength(0);
  });

  it('标题为 null 或空串被拒', async () => {
    await expect(validate(build({ title: null }))).resolves.not.toHaveLength(0);
    await expect(validate(build({ title: '' }))).resolves.not.toHaveLength(0);
  });
});
