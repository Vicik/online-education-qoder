import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// 编辑秒杀活动请求：对应 openapi FlashSaleUpdateRequest（仅未开始活动可编辑）
export class UpdateFlashSaleDto {
  // 乐观锁版本号：必须与当前版本一致
  @IsInt()
  @Min(1)
  version!: number;

  // 活动名称
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // 秒杀价（分）
  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  // 总库存：不得小于已售（服务层校验）
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  // 活动开始时间（ISO 8601）
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  // 活动结束时间（ISO 8601），必须晚于开始时间
  @IsOptional()
  @IsISO8601()
  endAt?: string;
}
