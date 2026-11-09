import { Injectable } from '@nestjs/common';
import { ActivityType } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { BizException } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceQuote, PricingStrategy } from './pricing.types';

// 普通购买策略：价格取课程售价，无活动
@Injectable()
export class NormalPricingStrategy implements PricingStrategy {
  readonly activityType: ActivityType = 'normal';

  // 构造函数：注入 Prisma 服务读取课程
  constructor(private readonly prisma: PrismaService) {}

  // 校验课程存在且已发布，返回售价报价
  async quote(input: {
    courseId: number; // 课程 id
    activityId: number | null; // 普通策略忽略活动 id
  }): Promise<PriceQuote> {
    // 查询课程基础信息
    const course = await this.prisma.course.findUnique({
      where: { id: input.courseId },
    });
    // 课程不存在
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }
    // 下架/草稿课程禁止购买
    if (course.status !== 'published') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '课程已下架，不可购买',
        422,
      );
    }

    return {
      priceCents: course.saleCents, // 当前价 = 课程售价
      activityType: this.activityType, // normal
      activityId: null, // 普通购买无活动
    };
  }
}
