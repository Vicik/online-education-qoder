import { Injectable } from '@nestjs/common';
import {
  CourseBrief,
  COURSE_BRIEF_SELECT,
  toCourseBrief,
} from '../catalog/course.service';
import { ErrorCode } from '../common/constants/error-codes';
import { PageQuery } from '../common/dto/page-query.dto';
import { PageResult } from '../common/dto/page-result';
import { BizException } from '../common/exceptions/biz.exception';
import { PrismaService } from '../prisma/prisma.service';

// 收藏服务：课程收藏的增删与分页查询（全部幂等）
@Injectable()
export class FavoriteService {
  // 构造函数：注入 Prisma 服务
  constructor(private readonly prisma: PrismaService) {}

  // 收藏课程：复合主键 upsert，重复收藏不报错
  async add(userId: number, courseId: number): Promise<void> {
    // 课程必须存在（用户端只能收藏可发现的课程）
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }

    await this.prisma.favorite.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId },
      update: {},
    });
  }

  // 取消收藏：deleteMany 幂等，未收藏时不报错
  async remove(userId: number, courseId: number): Promise<void> {
    await this.prisma.favorite.deleteMany({ where: { userId, courseId } });
  }

  // 我的收藏：按收藏时间倒序分页；下架课程仍返回（含状态，前端自行处理）
  async list(
    userId: number,
    page: PageQuery,
  ): Promise<PageResult<CourseBrief>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;

    const [rows, total] = await Promise.all([
      // 当前页收藏及其课程简要信息
      this.prisma.favorite.findMany({
        where: { userId },
        select: { course: { select: COURSE_BRIEF_SELECT } },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      // 收藏总数
      this.prisma.favorite.count({ where: { userId } }),
    ]);

    return {
      items: rows.map((row) => toCourseBrief(row.course)),
      total,
      page: pageNo,
      pageSize,
    };
  }
}
