import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

// 创建优惠券模板请求：对应 openapi CouponTemplateCreateRequest
export class CreateCouponTemplateDto {
  // 券名称
  @IsString()
  @IsNotEmpty()
  name!: string;

  // 抵扣面额（分）
  @IsInt()
  @Min(1)
  discountCents!: number;

  // 生效时间（ISO 8601）
  @IsISO8601()
  startAt!: string;

  // 失效时间（ISO 8601）
  @IsISO8601()
  endAt!: string;

  // 发放总量
  @IsInt()
  @Min(1)
  totalQty!: number;

  // 每人限领数量：本期服务端强制为 1，保留字段以对齐契约
  @IsInt()
  @Min(1)
  perUserLimit!: number;

  // 适用课程 id（必须全部已发布）
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  courseIds!: number[];

  // 创建后立即启用（默认不启用）
  @IsOptional()
  @IsBoolean()
  enableOnCreate?: boolean;
}
