import { QuestionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// 题目选项请求：key 为选项标识，text 为选项内容
export class QuestionOptionDto {
  // 选项标识（A/B/C…），同一题内不可重复
  @IsString()
  @IsNotEmpty()
  key!: string;

  // 选项内容
  @IsString()
  @IsNotEmpty()
  text!: string;
}

// 创建题目请求：对应 openapi QuestionCreateRequest
export class CreateQuestionDto {
  // 题型：单选/多选
  @IsEnum(QuestionType)
  type!: QuestionType;

  // 题干
  @IsString()
  @IsNotEmpty()
  stem!: string;

  // 选项：2~6 个，key 不可重复
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options!: QuestionOptionDto[];

  // 正确答案：单选恰好 1 个；多选至少 2 个
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  answer!: string[];

  // 答案解析（仅交卷后返回）
  @IsString()
  @IsNotEmpty()
  analysis!: string;

  // 题目分值：仅创建时确定，之后不可修改
  @IsInt()
  @Min(1)
  score!: number;
}
