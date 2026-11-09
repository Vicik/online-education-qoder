import { Prisma } from '@prisma/client';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { PrismaService } from '../prisma/prisma.service';

// 同课程活动互斥：拼团与秒杀任一时刻只能存在一个未取消的活动（项目说明文档 §活动规则）
export async function assertNoActivityOverlap(
  prisma: PrismaService,
  courseId: number,
  startAt: Date,
  endAt: Date,
  exclude?: { grouponId?: number; flashSaleId?: number },
): Promise<void> {
  // 公共条件：同课程、非取消、区间相交
  const base = {
    courseId,
    status: { not: 'cancelled' as const },
    startAt: { lt: endAt },
    endAt: { gt: startAt },
  };
  // 拼团占用查询：编辑拼团时排除自身
  const grouponWhere: Prisma.GrouponActivityWhereInput = {
    ...base,
    ...(exclude?.grouponId === undefined
      ? {}
      : { id: { not: exclude.grouponId } }),
  };
  // 秒杀占用查询：编辑秒杀时排除自身
  const flashSaleWhere: Prisma.FlashSaleActivityWhereInput = {
    ...base,
    ...(exclude?.flashSaleId === undefined
      ? {}
      : { id: { not: exclude.flashSaleId } }),
  };

  // 两类活动并行查询，任一命中即说明时间重叠
  const [groupon, flashSale] = await Promise.all([
    prisma.grouponActivity.findFirst({
      where: grouponWhere,
      select: { id: true },
    }),
    prisma.flashSaleActivity.findFirst({
      where: flashSaleWhere,
      select: { id: true },
    }),
  ]);
  if (groupon || flashSale) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '同课程已有时间重叠的活动',
      422,
    );
  }
}
