import { CourseType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

// 新增章节请求：对应 openapi ChapterCreateRequest
export class CreateChapterDto {
  // 章节标题，最多 60 个字符
  @IsString()
  @MaxLength(60)
  title!: string;

  // 章节内容类型，必须与课程类型一致
  @IsEnum(CourseType)
  contentType!: CourseType;

  // 章节正文：rich 为 HTML，video/audio 为对象存储 key
  @IsOptional()
  @IsString()
  content?: string | null;
}
