import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PageQuery } from '../common/dto/page-query.dto';
import { CourseService } from './course.service';

// 课程浏览控制器：游客可访问列表与详情
@Controller('courses')
export class CourseController {
  // 构造函数：注入课程服务
  constructor(private readonly courses: CourseService) {}

  // 已发布课程列表（公开，分页）
  @Public()
  @Get()
  list(@Query() page: PageQuery) {
    return this.courses.listPublished(page);
  }

  // 课程详情（公开；登录已购用户附带章节已学标记）
  @Public()
  @Get(':courseId')
  detail(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('courseId', ParseIntPipe) courseId: number,
  ) {
    return this.courses.getDetail(courseId, false, user?.userId);
  }

  // 章节正文（免费章节/免费课程公开；付费章节需登录且已购买）
  @Public()
  @Get(':courseId/chapters/:cid/content')
  content(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('cid', ParseIntPipe) chapterId: number,
  ) {
    return this.courses.getChapterContent(
      user?.userId ?? null,
      courseId,
      chapterId,
    );
  }
}
