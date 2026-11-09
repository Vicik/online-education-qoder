import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CourseService } from './course.service';

// 首页控制器：推荐课程
@Controller('home')
export class HomeController {
  // 构造函数：注入课程服务
  constructor(private readonly courses: CourseService) {}

  // 首页推荐（公开）：最近发布的 8 门已发布课程
  @Public()
  @Get('recommendations')
  async recommendations() {
    return { courses: await this.courses.listRecommendations() };
  }
}
