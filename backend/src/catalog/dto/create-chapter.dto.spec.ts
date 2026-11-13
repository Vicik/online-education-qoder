import { CourseType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateChapterDto } from './create-chapter.dto';

// 构造新增章节 DTO：可覆盖任意字段，未覆盖的字段使用合法值
function build(overrides: Record<string, unknown> = {}): CreateChapterDto {
  return plainToInstance(CreateChapterDto, {
    title: '第一节', // 章节标题
    contentType: CourseType.video, // 内容类型与课程一致
    content: 'video/2026/11/12/a.mp4', // 章节正文媒体 key
    ...overrides,
  });
}

describe('CreateChapterDto', () => {
  it('必填字段齐全时校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('缺少章节标题被拒', async () => {
    await expect(
      validate(build({ title: undefined })),
    ).resolves.not.toHaveLength(0);
  });

  it('章节标题为空串被拒', async () => {
    await expect(validate(build({ title: '' }))).resolves.not.toHaveLength(0);
  });

  it('缺少或为空的正文被拒', async () => {
    await expect(
      validate(build({ content: undefined })),
    ).resolves.not.toHaveLength(0);
    await expect(validate(build({ content: '' }))).resolves.not.toHaveLength(0);
    await expect(validate(build({ content: null }))).resolves.not.toHaveLength(0);
  });

  it('内容类型非法被拒', async () => {
    await expect(
      validate(build({ contentType: 'unknown' })),
    ).resolves.not.toHaveLength(0);
  });
});
