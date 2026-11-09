import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

// 编辑考试请求：对应 openapi ExamUpdateRequest，仅草稿可编辑
export class UpdateExamDto {
  // 乐观锁版本号，必须与当前记录一致
  @IsInt()
  @Min(1)
  version!: number;

  // 考试名称
  @IsOptional()
  @IsString()
  title?: string;

  // 考试说明
  @IsOptional()
  @IsString()
  description?: string;

  // 考试时长（分钟）
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMin?: number;

  // 及格分：修改后仍需大于 0 且不超过总分
  @IsOptional()
  @IsInt()
  @Min(1)
  passScore?: number;

  // 重新组卷：按新顺序重写草稿快照
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  questionIds?: number[];
}
