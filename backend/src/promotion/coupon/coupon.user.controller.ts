import {
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CouponClaimStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PageQuery } from '../../common/dto/page-query.dto';
import { BizException } from '../../common/exceptions/biz.exception';
import { CouponUserService } from './coupon.user.service';

// 我的券查询：分页 + 状态筛选
class MyCouponListQuery extends PageQuery {
  // 领取状态筛选
  @IsOptional()
  @IsEnum(CouponClaimStatus)
  status?: CouponClaimStatus;
}

// 课程可领券控制器：游客可访问（/api/v1/courses/:courseId/coupons）
@Controller('courses')
export class CourseCouponController {
  // 构造函数：注入用户端券服务
  constructor(private readonly coupons: CouponUserService) {}

  // 课程详情可领券列表
  @Public()
  @Get(':courseId/coupons')
  listForCourse(@Param('courseId', ParseIntPipe) courseId: number) {
    return this.coupons.listForCourse(courseId);
  }
}

// 领券控制器：登录 + Idempotency-Key（/api/v1/coupons/:templateId/claim）
@Controller('coupons')
export class CouponClaimController {
  // 构造函数：注入用户端券服务
  constructor(private readonly coupons: CouponUserService) {}

  // 领取优惠券（201；重放返回首次结果）
  @Post(':templateId/claim')
  claim(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('templateId', ParseIntPipe) templateId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    // 幂等键边界校验：8–128 字符
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (key.length < 8 || key.length > 128) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        'Idempotency-Key 长度须为 8-128 字符',
        400,
      );
    }
    return this.coupons.claim(user!.userId, templateId, key);
  }
}

// 我的券控制器：登录用户查看本人领取记录（/api/v1/user/coupons）
@Controller('user')
export class MyCouponController {
  // 构造函数：注入用户端券服务
  constructor(private readonly coupons: CouponUserService) {}

  // 我的优惠券分页
  @Get('coupons')
  list(
    @CurrentUser() user: CurrentUserInfo | null,
    @Query() query: MyCouponListQuery,
  ) {
    return this.coupons.listMine(user!.userId, query.status, query);
  }
}
