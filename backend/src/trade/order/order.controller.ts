import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
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
import { PageQuery } from '../../common/dto/page-query.dto';
import { BizException } from '../../common/exceptions/biz.exception';
import { CheckoutQuery } from '../dto/checkout-query.dto';
import { CreateOrderDto } from '../dto/create-order.dto';
import { OrderService } from './order.service';
import { PricingService } from '../pricing/pricing.service';

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

// 价格预览控制器：登录用户按课程/活动/券获取服务端报价
@Controller('checkout')
export class CheckoutController {
  // 构造函数：注入计价服务
  constructor(private readonly pricing: PricingService) {}

  // 价格预览（客户端不传金额）
  @Get(':courseId/preview')
  preview(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Query() query: CheckoutQuery,
  ) {
    return this.pricing.preview(user!.userId, courseId, query);
  }
}

// 订单控制器：创建（幂等）/支付/详情
@Controller('orders')
export class OrderController {
  // 构造函数：注入订单服务
  constructor(private readonly orders: OrderService) {}

  // 创建订单（201；同幂等键重放返回首次结果）
  @Post()
  create(
    @CurrentUser() user: CurrentUserInfo | null,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateOrderDto,
  ) {
    // 幂等键必填校验
    const key = requireIdempotencyKey(idempotencyKey);
    return this.orders.createOrder(user!.userId, dto, key);
  }

  // 模拟支付（200；已支付幂等返回首次结果）
  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  pay(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) orderId: number,
  ) {
    return this.orders.pay(user!.userId, orderId);
  }

  // 订单详情（归属校验）
  @Get(':id')
  detail(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) orderId: number,
  ) {
    return this.orders.getOrder(user!.userId, orderId);
  }
}

// 我的订单控制器：仅本人订单（/api/v1/user/orders）
@Controller('user')
export class MyOrderController {
  // 构造函数：注入订单服务
  constructor(private readonly orders: OrderService) {}

  // 我的购买记录分页
  @Get('orders')
  list(@CurrentUser() user: CurrentUserInfo | null, @Query() page: PageQuery) {
    return this.orders.listUserOrders(user!.userId, page);
  }
}
