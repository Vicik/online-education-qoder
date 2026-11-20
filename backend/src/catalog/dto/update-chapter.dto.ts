import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// 编辑章节请求：对应 openapi ChapterUpdateRequest，内容类型继承课程类型不可改
export class UpdateChapterDto {
  // 章节标题，最多 60 个字符（传入时不可为 null 或空串）
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  title?: string;

  // 章节正文：视频/音频媒体 key（不传表示保持原正文，传入时不可为空）
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  content?: string;

  // 是否免费试看：传入即设置
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;
}
