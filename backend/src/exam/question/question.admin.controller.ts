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
import { EnabledStatus, QuestionType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { Request } from 'express';
import { AuditContext } from '../../audit/audit.service';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PageQuery } from '../../common/dto/page-query.dto';
import { CreateQuestionDto } from '../dto/create-question.dto';
import { UpdateQuestionDto } from '../dto/update-question.dto';
import { QuestionAdminService } from './question.admin.service';

// 管理端题目列表查询：分页 + 题型/状态筛选
class AdminQuestionListQuery extends PageQuery {
  // 题型筛选
  @IsOptional()
  @IsEnum(QuestionType)
  type?: QuestionType;

  // 状态筛选
  @IsOptional()
  @IsEnum(EnabledStatus)
  status?: EnabledStatus;
}

// 题目管理端控制器：全部路由仅 admin 可访问（/api/v1/admin/questions）
@Controller('admin/questions')
@Roles('admin')
export class QuestionAdminController {
  // 构造函数：注入题目管理服务
  constructor(private readonly questions: QuestionAdminService) {}

  // 题目列表（含答案/解析）
  @Get()
  list(@Query() query: AdminQuestionListQuery) {
    return this.questions.list(query, {
      type: query.type,
      status: query.status,
    });
  }

  // 创建题目（分值仅创建时确定）
  @Post()
  create(
    @Body() dto: CreateQuestionDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.questions.create(dto, this.auditContext(user, req));
  }

  // 题目详情
  @Get(':id')
  detail(@Param('id', ParseIntPipe) questionId: number) {
    return this.questions.getDetail(questionId);
  }

  // 编辑题目（分值不可改；version 乐观锁）
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) questionId: number,
    @Body() dto: UpdateQuestionDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.questions.update(questionId, dto, this.auditContext(user, req));
  }

  // 启用题目
  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  enable(
    @Param('id', ParseIntPipe) questionId: number,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.questions.enable(questionId, this.auditContext(user, req));
  }

  // 停用题目
  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  disable(
    @Param('id', ParseIntPipe) questionId: number,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.questions.disable(questionId, this.auditContext(user, req));
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
