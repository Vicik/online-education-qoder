import { QuestionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
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

  // 题干：不传表示不改，传入时不可为 null 或空串
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  stem?: string;

  // 选项：2~6 个，key 不可重复
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];

  // 正确答案：不传表示不改，传入时不可为空数组或空串元素
  @ValidateIf((_dto, value) => value !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  answer?: string[];

  // 答案解析：不传表示不改，传入时不可为 null 或空串
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  analysis?: string;

  // 分值不可改：兼容客户端误传，服务端忽略该字段
  @IsOptional()
  @IsInt()
  @Min(1)
  score?: number;
}
