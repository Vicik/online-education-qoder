import { ArrayUnique, IsArray, IsInt } from 'class-validator';

// 章节排序请求：对应 openapi ChapterReorderRequest
export class ReorderChaptersDto {
  // 全部章节 id 的新顺序，保存后从 1 连续编号
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  orderedChapterIds!: number[];
}
