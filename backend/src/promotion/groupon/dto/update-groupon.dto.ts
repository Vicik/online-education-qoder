import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// 编辑拼团活动请求：对应 openapi GrouponUpdateRequest（仅未开始活动可编辑）
export class UpdateGrouponDto {
  // 乐观锁版本号：必须与当前版本一致
  @IsInt()
  @Min(1)
  version!: number;

  // 活动名称
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // 拼团价（分）
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  // 成团人数：至少 2 人
  @IsOptional()
  @IsInt()
  @Min(2)
  targetSize?: number;

  // 活动开始时间（ISO 8601）
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  // 活动结束时间（ISO 8601），必须晚于开始时间
  @IsOptional()
  @IsISO8601()
  endAt?: string;
}
