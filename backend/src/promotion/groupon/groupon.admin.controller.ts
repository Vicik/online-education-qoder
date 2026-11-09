import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { IsInt, IsOptional, Min } from 'class-validator';
import { Request } from 'express';
import { AuditContext } from '../../audit/audit.service';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PageQuery } from '../../common/dto/page-query.dto';
import { CreateGrouponDto } from './dto/create-groupon.dto';
import { UpdateGrouponDto } from './dto/update-groupon.dto';
import { GrouponAdminService } from './groupon.admin.service';

// 取消活动请求体：version 可选（openapi 未声明请求体，乐观锁按需生效）
class CancelGrouponDto {
  // 乐观锁版本号
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

// 拼团活动管理端控制器：全部路由仅 admin 可访问（/api/v1/admin/groupons）
@Controller('admin/groupons')
@Roles('admin')
export class GrouponAdminController {
  // 构造函数：注入活动管理服务
  constructor(private readonly groupons: GrouponAdminService) {}

  // 活动列表（全状态）
  @Get()
  list(@Query() page: PageQuery) {
    return this.groupons.listAll(page);
  }

  // 创建活动（仅已发布课程；同课程时间不重叠）
  @Post()
  create(
    @Body() dto: CreateGrouponDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.groupons.create(dto, this.auditContext(user, req));
  }

  // 编辑活动（仅未开始；version 乐观锁）
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) activityId: number,
    @Body() dto: UpdateGrouponDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.groupons.update(activityId, dto, this.auditContext(user, req));
  }

  // 取消活动（仅未开始）
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseIntPipe) activityId: number,
    @Body() dto: CancelGrouponDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.groupons.cancel(
      activityId,
      dto?.version === undefined ? undefined : { version: dto.version },
      this.auditContext(user, req),
    );
  }

  // 从会话与请求中提取审计上下文
  private auditContext(
    user: CurrentUserInfo | null,
    req: Request,
  ): AuditContext {
    // 请求头中的追踪 id（由 RequestIdMiddleware 写入）
    const header = req.headers['x-request-id'];
    return {
      actorId: user!.userId, // 操作人
      ip: req.ip, // 客户端 IP
      requestId: typeof header === 'string' ? header : undefined, // 追踪 id
    };
  }
}
