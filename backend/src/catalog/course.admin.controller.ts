import {
  Body,
  Controller,
  Delete,
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
import { AuditContext } from '../audit/audit.service';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ChapterAdminService } from './chapter.admin.service';
import { CourseAdminService } from './course.admin.service';
import { AdminCourseListQuery } from './dto/admin-course-list-query.dto';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { CreateCourseDto } from './dto/create-course.dto';
import { ReorderChaptersDto } from './dto/reorder-chapters.dto';
import { UpdateChapterDto } from './dto/update-chapter.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

// 课程管理端控制器：全部路由仅 admin 可访问（/api/v1/admin/courses）
@Controller('admin/courses')
@Roles('admin')
export class CourseAdminController {
  // 构造函数：注入课程与章节管理服务
  constructor(
    private readonly courses: CourseAdminService,
    private readonly chapters: ChapterAdminService,
  ) {}

  // 课程列表（全部状态，可按状态筛选）
  @Get()
  list(@Query() query: AdminCourseListQuery) {
    return this.courses.listAll(query, query.status);
  }

  // 创建课程（草稿）
  @Post()
  create(
    @Body() dto: CreateCourseDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.courses.create(dto, this.auditContext(user, req));
  }

  // 课程详情（含草稿/下架）
  @Get(':courseId')
  detail(@Param('courseId', ParseIntPipe) courseId: number) {
    return this.courses.getDetail(courseId);
  }

  // 编辑基本信息（状态矩阵 + 乐观锁）
  @Put(':courseId')
  update(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.courses.update(courseId, dto, this.auditContext(user, req));
  }

  // 发布/重新发布
  @Post(':courseId/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('courseId', ParseIntPipe) courseId: number,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.courses.publish(courseId, this.auditContext(user, req));
  }

  // 下架（openapi 无请求体）
  @Post(':courseId/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @Param('courseId', ParseIntPipe) courseId: number,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.courses.unpublish(
      courseId,
      undefined,
      this.auditContext(user, req),
    );
  }

  // 新增章节（草稿/已下架）
  @Post(':courseId/chapters')
  addChapter(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: CreateChapterDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.chapters.addChapter(
      courseId,
      dto,
      this.auditContext(user, req),
    );
  }

  // 章节排序（两阶段重编号）
  @Post(':courseId/chapters/reorder')
  @HttpCode(HttpStatus.OK)
  reorderChapters(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: ReorderChaptersDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.chapters.reorderChapters(
      courseId,
      dto,
      this.auditContext(user, req),
    );
  }

  // 编辑章节
  @Put(':courseId/chapters/:cid')
  updateChapter(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('cid', ParseIntPipe) chapterId: number,
    @Body() dto: UpdateChapterDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.chapters.updateChapter(
      courseId,
      chapterId,
      dto,
      this.auditContext(user, req),
    );
  }

  // 删除章节
  @Delete(':courseId/chapters/:cid')
  deleteChapter(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('cid', ParseIntPipe) chapterId: number,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.chapters.deleteChapter(
      courseId,
      chapterId,
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
