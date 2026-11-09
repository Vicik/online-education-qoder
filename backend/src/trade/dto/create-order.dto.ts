import { ActivityType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

// 创建订单请求：客户端只传选择项，金额一律由服务端计算
export class CreateOrderDto {
  // 课程 id
  @IsInt()
  @Min(1)
  courseId: number;

  // 活动类型：普通/拼团/秒杀，默认普通
  @IsOptional()
  @IsEnum(ActivityType)
  activityType?: ActivityType;

  // 活动 id：拼团为团组 id，秒杀为活动 id
  @IsOptional()
  @IsInt()
  @Min(1)
  activityId?: number | null;

  // 使用的券领取记录 id
  @IsOptional()
  @IsInt()
  @Min(1)
  couponClaimId?: number | null;
}
