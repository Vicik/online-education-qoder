import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { EnabledStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { Request } from 'express';
import { AuditContext } from '../../audit/audit.service';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PageQuery } from '../../common/dto/page-query.dto';
import {
  CreateBlockedWordDto,
  UpdateBlockedWordDto,
} from '../dto/create-blocked-word.dto';
import { BlockedWordService } from './blocked-word.service';

// 管理端屏蔽词列表查询：分页 + 状态筛选
class AdminBlockedWordListQuery extends PageQuery {
  // 状态筛选（可选）
  @IsOptional()
  @IsEnum(EnabledStatus)
  status?: EnabledStatus;
}

// 屏蔽词管理端控制器：全部路由仅 admin 可访问（/api/v1/admin/blocked-words）
@Controller('admin/blocked-words')
@Roles('admin')
export class BlockedWordAdminController {
  // 构造函数：注入屏蔽词服务
  constructor(private readonly blockedWords: BlockedWordService) {}

  // 屏蔽词列表
  @Get()
  list(@Query() query: AdminBlockedWordListQuery) {
    return this.blockedWords.list(query.status, query);
  }

  // 新增屏蔽词（修改后立即影响用户端）
  @Post()
  create(
    @Body() dto: CreateBlockedWordDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.blockedWords.create(dto.word, this.auditContext(user, req));
  }

  // 启用 / 停用 / 修改屏蔽词
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBlockedWordDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.blockedWords.update(id, dto, this.auditContext(user, req));
  }

  // 删除屏蔽词
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.blockedWords.remove(id, this.auditContext(user, req));
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
