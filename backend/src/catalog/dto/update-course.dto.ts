import { CourseType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// 编辑课程请求：对应 openapi CourseUpdateRequest，version 必填，其余按状态矩阵生效
export class UpdateCourseDto {
  // 乐观锁版本号（必填）
  @IsInt()
  @Min(1)
  version!: number;

  // 课程名称，最多 40 个字符（仅草稿可改）
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string;

  // 课程类型（仅草稿且无章节时可改）
  @IsOptional()
  @IsEnum(CourseType)
  type?: CourseType;

  // 原价（分，仅草稿可改）
  @IsOptional()
  @IsInt()
  @Min(0)
  originalCents?: number;

  // 售价（分，仅草稿可改，不得高于原价）
  @IsOptional()
  @IsInt()
  @Min(0)
  saleCents?: number;

  // 讲师名称（可选；传入时不可为 null 或空串）
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  instructor?: string;

  // 封面地址（可选；传入时不可为 null 或空串）
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  coverUrl?: string;

  // 课程简介
  @IsOptional()
  @IsString()
  intro?: string | null;

  // 课程详细介绍（富文本，服务端净化）
  @IsOptional()
  @IsString()
  detailRich?: string | null;
}
