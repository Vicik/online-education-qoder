import { CourseType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// 新增章节请求：对应 openapi ChapterCreateRequest
export class CreateChapterDto {
  // 章节标题，最多 60 个字符
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  title!: string;

  // 章节内容类型，必须与课程类型一致
  @IsEnum(CourseType)
  contentType!: CourseType;

  // 章节正文：视频/音频媒体 key，必填
  @IsString()
  @IsNotEmpty()
  content!: string;

  // 是否免费试看：默认 false
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;
}
