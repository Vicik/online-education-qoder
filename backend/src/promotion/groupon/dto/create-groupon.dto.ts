import { IsInt, IsISO8601, IsNotEmpty, IsString, Min } from 'class-validator';

// 创建拼团活动请求：对应 openapi GrouponCreateRequest
export class CreateGrouponDto {
  // 关联课程 id：仅已发布课程可创建活动
  @IsInt()
  @Min(1)
  courseId!: number;

  // 活动名称
  @IsString()
  @IsNotEmpty()
  name!: string;

  // 拼团价（分）
  @IsInt()
  @Min(0)
  priceCents!: number;

  // 成团人数：至少 2 人
  @IsInt()
  @Min(2)
  targetSize!: number;

  // 活动开始时间（ISO 8601）
  @IsISO8601()
  startAt!: string;

  // 活动结束时间（ISO 8601），必须晚于开始时间
  @IsISO8601()
  endAt!: string;
}
