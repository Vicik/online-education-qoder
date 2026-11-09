import { Type } from 'class-transformer';
import { ActivityType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

// 价格预览查询参数：客户端只选券/活动，不传任何金额
export class CheckoutQuery {
  // 选中的券领取记录 id
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  couponId?: number;

  // 活动类型：普通/拼团/秒杀，默认普通
  @IsOptional()
  @IsEnum(ActivityType)
  activityType?: ActivityType;

  // 活动 id：拼团为团组 id，秒杀为活动 id
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  activityId?: number;
}
