import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// 编辑优惠券模板请求：对应 openapi CouponTemplateUpdateRequest（仅停用态可改）
export class UpdateCouponTemplateDto {
  // 乐观锁版本号
  @IsInt()
  @Min(1)
  version!: number;

  // 券名称
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  // 抵扣面额（分）
  @IsOptional()
  @IsInt()
  @Min(1)
  discountCents?: number;

  // 生效时间（ISO 8601）
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  // 失效时间（ISO 8601）
  @IsOptional()
  @IsISO8601()
  endAt?: string;

  // 发放总量
  @IsOptional()
  @IsInt()
  @Min(1)
  totalQty?: number;

  // 每人限领数量：本期服务端强制为 1
  @IsOptional()
  @IsInt()
  @Min(1)
  perUserLimit?: number;

  // 适用课程 id（整体重设，必须全部已发布）
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  courseIds?: number[];
}
