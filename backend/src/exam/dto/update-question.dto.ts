import { QuestionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuestionOptionDto } from './create-question.dto';

// 编辑题目请求：对应 openapi QuestionUpdateRequest
export class UpdateQuestionDto {
  // 乐观锁版本号，必须与当前记录一致
  @IsInt()
  @Min(1)
  version!: number;

  // 题型（可改；需与最终答案数量匹配）
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  // 题干
  @IsOptional()
  @IsString()
  stem?: string;

  // 选项：2~6 个，key 不可重复
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];

  // 正确答案：改动后仍需满足题型规则
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  answer?: string[];

  // 答案解析
  @IsOptional()
  @IsString()
  analysis?: string;

  // 分值不可改：兼容客户端误传，服务端忽略该字段
  @IsOptional()
  @IsInt()
  @Min(1)
  score?: number;
}
