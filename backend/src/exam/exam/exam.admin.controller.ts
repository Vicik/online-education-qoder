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
import { Request } from 'express';
import { AuditContext } from '../../audit/audit.service';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PageQuery } from '../../common/dto/page-query.dto';
import { CreateExamDto } from '../dto/create-exam.dto';
import { UpdateExamDto } from '../dto/update-exam.dto';
import { ExamAdminService } from './exam.admin.service';

// 考试管理端控制器：全部路由仅 admin 可访问（/api/v1/admin/exams）
@Controller('admin/exams')
@Roles('admin')
export class ExamAdminController {
  // 构造函数：注入考试管理服务
  constructor(private readonly exams: ExamAdminService) {}

  // 考试列表
  @Get()
  list(@Query() page: PageQuery) {
    return this.exams.list(page);
  }

  // 创建考试（草稿组卷）
  @Post()
  create(
    @Body() dto: CreateExamDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.exams.create(dto, this.auditContext(user, req));
  }

  // 考试详情（含组卷题目 id）
  @Get(':id')
  detail(@Param('id', ParseIntPipe) examId: number) {
    return this.exams.getDetail(examId);
  }

  // 编辑考试（仅草稿；version 乐观锁）
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) examId: number,
    @Body() dto: UpdateExamDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.exams.update(examId, dto, this.auditContext(user, req));
  }

  // 发布考试（冻结题目快照）
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('id', ParseIntPipe) examId: number,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.exams.publish(examId, this.auditContext(user, req));
  }

  // 结束考试
  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  end(
    @Param('id', ParseIntPipe) examId: number,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.exams.end(examId, this.auditContext(user, req));
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
