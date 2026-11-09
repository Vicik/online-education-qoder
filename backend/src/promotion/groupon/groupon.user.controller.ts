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
import { GrouponUserService } from './groupon.user.service';

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

// 拼团用户端控制器：活动浏览公开，开团/参团需登录（/api/v1/groupons）
@Controller('groupons')
export class GrouponUserController {
  // 构造函数：注入用户端拼团服务
  constructor(private readonly groupons: GrouponUserService) {}

  // 进行中活动列表（公开）
  @Public()
  @Get()
  list(@Query() page: PageQuery) {
    return this.groupons.listActivities(page);
  }

  // 活动详情 + 待成团团组（公开）
  @Public()
  @Get(':id')
  detail(@Param('id', ParseIntPipe) activityId: number) {
    return this.groupons.getActivity(activityId);
  }

  // 发起新团（201；同幂等键重放返回首次结果）
  @Post(':id/groups')
  createGroup(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) activityId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    // 幂等键必填校验
    const key = requireIdempotencyKey(idempotencyKey);
    return this.groupons.createGroup(user!.userId, activityId, key);
  }

  // 加入待成团团组（201；同幂等键重放返回首次结果）
  @Post(':id/groups/:gid/join')
  joinGroup(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) activityId: number,
    @Param('gid', ParseIntPipe) groupId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    // 幂等键必填校验
    const key = requireIdempotencyKey(idempotencyKey);
    return this.groupons.joinGroup(user!.userId, activityId, groupId, key);
  }
}

// 我的拼团控制器：登录用户查看本人参与记录（/api/v1/user/groupons）
@Controller('user')
export class MyGrouponController {
  // 构造函数：注入用户端拼团服务
  constructor(private readonly groupons: GrouponUserService) {}

  // 我的拼团分页
  @Get('groupons')
  list(@CurrentUser() user: CurrentUserInfo | null, @Query() page: PageQuery) {
    return this.groupons.listMine(user!.userId, page);
  }
}
