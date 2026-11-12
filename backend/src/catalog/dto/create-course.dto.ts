import { CourseType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// 创建课程请求：对应 openapi CourseCreateRequest（管理端额外允许保存编辑字段）
export class CreateCourseDto {
  // 课程名称，最多 40 个字符
  @IsString()
  @MaxLength(40)
  name!: string;

  // 课程类型：视频/音频/图文
  @IsEnum(CourseType)
  type!: CourseType;

  // 原价（分）
  @IsInt()
  @Min(0)
  originalCents!: number;

  // 售价（分），不得高于原价
  @IsInt()
  @Min(0)
  saleCents!: number;

  // 讲师名称（必填）
  @IsString()
  @IsNotEmpty()
  instructor!: string;

  // 封面地址（必填）
  @IsString()
  @IsNotEmpty()
  coverUrl!: string;

  // 课程简介
  @IsOptional()
  @IsString()
  intro?: string | null;

  // 课程详细介绍（富文本，服务端净化）
  @IsOptional()
  @IsString()
  detailRich?: string | null;
}
