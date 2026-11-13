import { Injectable } from '@nestjs/common';
import { FlashSaleActivity, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { PageQuery } from '../../common/dto/page-query.dto';
import { PageResult } from '../../common/dto/page-result';
import { BizException } from '../../common/exceptions/biz.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { OrderService, OrderView } from '../../trade/order/order.service';
import { PricingService } from '../../trade/pricing/pricing.service';
import { FlashStockService } from './flash-stock.service';
import {
  FlashSaleActivityView,
  FlashSaleActivityWithCourse,
  toFlashSaleActivityView,
} from './flash-sale.mapper';

// 秒杀下单结果：openapi 约定 data 为 { order }
export interface FlashPurchaseResult {
  order: OrderView; // 待支付订单
}

// 提取 Prisma 唯一冲突的目标字段/索引文本
function uniqueTargetText(error: unknown): string {
  // P2002 的 meta.target 可能是字段数组，也可能是约束名
  const target = (error as { meta?: { target?: unknown } } | null)?.meta
    ?.target;
  // 统一转为可搜索的文本
  return Array.isArray(target) ? target.join(',') : String(target ?? '');
}

// 判断是否为秒杀限购冲突：原始 P2002 或订单服务已映射的 4003
function isFlashPurchaseConflict(error: unknown): boolean {
  // 订单服务会把 purchaseKey/flashPurchaseKey 冲突映射为重复购买
  if (error instanceof BizException) {
    return error.bizCode === ErrorCode.DUPLICATE_PURCHASE;
  }
  // 直接调用订单服务（未经其映射）时仍可能是原始 P2002
  if ((error as { code?: string } | null)?.code !== 'P2002') return false;
  const target = uniqueTargetText(error);
  return target.includes('flashPurchaseKey') || target.includes('purchaseKey');
}

// 活动当前是否可抢购：进行中、已到开始时间且未结束
function isPurchasable(activity: FlashSaleActivity, now: Date): boolean {
  return (
    activity.status === 'ongoing' &&
    activity.startAt.getTime() <= now.getTime() &&
    activity.endAt.getTime() > now.getTime()
  );
}

// 秒杀用户端服务：公开浏览、库存展示与幂等下单
@Injectable()
export class FlashSaleUserService {
  // 构造函数：注入数据库、订单、计价、幂等与 Redis 库存
  constructor(
    private readonly prisma: PrismaService, // 数据库访问
    private readonly orders: OrderService, // 订单创建入口
    private readonly pricing: PricingService, // 服务端计价
    private readonly idempotency: IdempotencyService, // 下单幂等
    private readonly stock: FlashStockService, // Redis 预占与剩余
    private readonly storage: StorageService, // 课程封面地址解析
  ) {}

  // 活动列表（公开）：仅进行中且未结束，带服务端剩余库存
  async listActivities(
    page: PageQuery,
  ): Promise<PageResult<FlashSaleActivityView>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 公开列表仅展示进行中且未结束的活动
    const where: Prisma.FlashSaleActivityWhereInput = {
      status: 'ongoing',
      endAt: { gt: new Date() },
    };

    const [rows, total] = await Promise.all([
      // 当前页活动（带课程名称、封面与原价，供卡片展示）
      this.prisma.flashSaleActivity.findMany({
        where,
        include: {
          course: {
            select: { name: true, coverUrl: true, originalCents: true },
          },
        },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { startAt: 'asc' },
      }),
      // 总数
      this.prisma.flashSaleActivity.count({ where }),
    ]);

    // 剩余库存以 Redis 预占计数为准（缺失回源 DB），封面 key 解析为公开地址
    const items = await Promise.all(rows.map((row) => this.toPublicView(row)));

    return { items, total, page: pageNo, pageSize };
  }

  // 活动详情（公开）：总库存/已售/剩余库存与倒计时字段
  async getActivity(activityId: number): Promise<FlashSaleActivityView> {
    // 活动必须存在（带课程封面与原价，供详情页展示）
    const activity = await this.prisma.flashSaleActivity.findUnique({
      where: { id: activityId },
      include: {
        course: {
          select: { name: true, coverUrl: true, originalCents: true },
        },
      },
    });
    if (!activity) {
      throw new BizException(
        ErrorCode.RESOURCE_NOT_FOUND,
        '秒杀活动不存在',
        404,
      );
    }
    // 剩余库存取 Redis 预占后的值
    return this.toPublicView(activity);
  }

  // 活动视图补充用户端展示字段：剩余库存、课程封面公开地址与原价
  private async toPublicView(
    row: FlashSaleActivityWithCourse,
  ): Promise<FlashSaleActivityView> {
    return {
      ...toFlashSaleActivityView(row, await this.stock.remaining(row.id)),
      courseCoverUrl: await this.storage.resolveUrl(row.course.coverUrl),
      courseOriginalCents: row.course.originalCents,
    };
  }

  // 秒杀下单：Redis 预扣成功后才建单；建单失败回补；限购冲突转 5003
  async purchase(
    userId: number,
    activityId: number,
    idempotencyKey: string,
  ): Promise<FlashPurchaseResult> {
    // 幂等端点包含活动 id，避免同一幂等键跨活动命中错误结果
    return this.idempotency.run(
      userId,
      idempotencyKey,
      `POST /flash-sales/${activityId}/purchase`,
      async () => {
        // 活动必须存在
        const activity = await this.prisma.flashSaleActivity.findUnique({
          where: { id: activityId },
        });
        if (!activity) {
          throw new BizException(
            ErrorCode.RESOURCE_NOT_FOUND,
            '秒杀活动不存在',
            404,
          );
        }
        // 仅进行中且处于有效期内的活动可下单
        if (!isPurchasable(activity, new Date())) {
          throw new BizException(
            ErrorCode.ACTIVITY_NOT_STARTED,
            '秒杀活动未开始或已结束',
            422,
          );
        }
        // Redis 预扣：售罄直接拒绝，不产生订单
        if (!(await this.stock.preDeduct(activityId))) {
          throw new BizException(ErrorCode.STOCK_INSUFFICIENT, '已售罄', 422);
        }

        try {
          // 服务端计价：秒杀价来自活动
          const quote = await this.pricing.resolve('flash_sale').quote({
            courseId: activity.courseId,
            activityId,
          });
          // 生成待支付订单；activityId 写入 flashPurchaseKey 实现一人一单
          const order = await this.orders.createOrderWithQuote(
            userId,
            quote,
            {
              courseId: activity.courseId,
              activityType: 'flash_sale',
              activityId,
            },
            idempotencyKey,
          );
          return { order };
        } catch (error) {
          // 订单未创建成功：释放预占
          await this.stock.restore(activityId);
          // 同一用户重复购买同一活动
          if (isFlashPurchaseConflict(error)) {
            throw new BizException(
              ErrorCode.PURCHASE_LIMIT,
              '同一活动限购一次',
              409,
            );
          }
          throw error;
        }
      },
    );
  }
}
