import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// 创建考试请求：对应 openapi ExamCreateRequest
export class CreateExamDto {
  // 考试名称
  @IsString()
  @IsNotEmpty()
  title!: string;

  // 考试说明，默认空字符串
  @IsOptional()
  @IsString()
  description?: string;

  // 考试时长（分钟）
  @IsInt()
  @Min(1)
  durationMin!: number;

  // 及格分：大于 0 且不超过试卷总分
  @IsInt()
  @Min(1)
  passScore!: number;

  // 组卷题目 id（按顺序出题；分值不可在组卷时修改）
  @IsArray()
  @IsInt({ each: true })
  questionIds!: number[];
}
