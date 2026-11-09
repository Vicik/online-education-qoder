import { Module } from '@nestjs/common';
import { ChapterAdminService } from './chapter.admin.service';
import { CourseAdminController } from './course.admin.controller';
import { CourseAdminService } from './course.admin.service';
import { CourseController } from './course.controller';
import { CourseService } from './course.service';
import { HomeController } from './home.controller';

// 课程模块：用户端课程浏览 + 管理端课程/章节管理（学习模块复用 CourseService）
@Module({
  controllers: [CourseController, HomeController, CourseAdminController],
  providers: [CourseService, CourseAdminService, ChapterAdminService],
  exports: [CourseService],
})
export class CatalogModule {}
