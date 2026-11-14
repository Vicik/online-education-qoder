import { CourseStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { PageQuery } from '../../common/dto/page-query.dto';

// 管理端课程列表查询：分页参数 + 可选状态筛选
export class AdminCourseListQuery extends PageQuery {
  // 课程状态筛选（缺省返回全部状态）
  @IsOptional()
  @IsEnum(CourseStatus)
  status?: CourseStatus;

  // 仅返回当前没有未开始/进行中活动的课程（拼团/秒杀表单选课用）
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  withoutActivePromotion?: boolean;
}
