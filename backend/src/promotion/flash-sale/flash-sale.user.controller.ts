import {
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PageQuery } from '../../common/dto/page-query.dto';
import { BizException } from '../../common/exceptions/biz.exception';
import { FlashSaleUserService } from './flash-sale.user.service';

// 幂等键边界校验：8–128 字符，缺失/越界按参数无效处理
function requireIdempotencyKey(raw: string | undefined): string {
  // 去除首尾空白
  const key = typeof raw === 'string' ? raw.trim() : '';
  // 长度不符合契约要求
  if (key.length < 8 || key.length > 128) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      'Idempotency-Key 长度须为 8-128 字符',
      400,
    );
  }
  return key;
}

// 秒杀用户端控制器：浏览公开，下单需登录（/api/v1/flash-sales）
@Controller('flash-sales')
export class FlashSaleUserController {
  // 构造函数：注入用户端秒杀服务
  constructor(private readonly flashSales: FlashSaleUserService) {}

  // 活动列表（公开，含剩余库存）
  @Public()
  @Get()
  list(@Query() page: PageQuery) {
    return this.flashSales.listActivities(page);
  }

  // 活动详情（公开，含剩余库存与倒计时）
  @Public()
  @Get(':id')
  detail(@Param('id', ParseIntPipe) activityId: number) {
    return this.flashSales.getActivity(activityId);
  }

  // 秒杀下单（201；幂等 + 一人一单 + 防超卖）
  @Post(':id/purchase')
  purchase(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) activityId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    // 幂等键必填校验
    const key = requireIdempotencyKey(idempotencyKey);
    return this.flashSales.purchase(user!.userId, activityId, key);
  }
}
