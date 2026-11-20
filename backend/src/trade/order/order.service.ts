import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ActivityType, Order, OrderStatus } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { BizException } from '../../common/exceptions/biz.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PageQuery } from '../../common/dto/page-query.dto';
import { PageResult } from '../../common/dto/page-result';
import { CouponUserService } from '../../promotion/coupon/coupon.user.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto } from '../dto/create-order.dto';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from '../payment/payment-gateway.interface';
import {
  POST_PAYMENT_HANDLERS,
  PostPaymentHandler,
} from '../payment/post-payment-handler.interface';
import { PricingService } from '../pricing/pricing.service';
import { PriceQuote } from '../pricing/pricing.types';

// 默认待支付超时（分钟）：配置缺失时兜底
const DEFAULT_PENDING_TTL_MINUTES = 15;
// 幂等端点标识：下单接口
const ORDER_CREATE_ENDPOINT = 'POST /orders';
// 模拟支付渠道标识：payments.channel 字段承载
const MOCK_PAYMENT_CHANNEL = 'mock';

// 秒杀库存回补回调注入令牌：由交易模块用库存服务实现，避免模块环依赖
export const FLASH_STOCK_RESTORE = 'FLASH_STOCK_RESTORE';

// 秒杀库存回补函数：按活动 id 归还一件 Redis 预占
export type FlashStockRestore = (activityId: number) => Promise<void>;

// 订单响应：与 openapi Order 一致（补充课程名称便于前端展示）
export interface OrderView {
  id: number; // 订单 id
  orderNo: string; // 订单号
  courseId: number; // 课程 id
  courseName: string; // 课程名称
  activityType: ActivityType; // 活动类型
  activityId: number | null; // 活动 id
  originalCents: number; // 课程原价（分）
  currentCents: number; // 当前价（分）
  discountCents: number; // 券抵扣额（分）
  paidCents: number; // 实付（分）
  couponClaimId: number | null; // 使用的券领取记录 id
  status: OrderStatus; // 订单状态
  paidAt: Date | null; // 支付时间
  createdAt: Date; // 创建时间
}

// 管理端订单响应：附带下单用户信息（客服/审计排查用）
export interface AdminOrderView extends OrderView {
  user: {
    id: number; // 用户 id
    email: string; // 邮箱
    nickname: string; // 昵称
  };
}

// 判断错误是否为 Prisma 唯一约束冲突（P2002）
function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

// 提取唯一冲突的字段/索引名文本（兼容数组字段名与索引名字符串两种形态）
function uniqueTargetText(error: unknown): string {
  // P2002 的 meta.target 可能是字段数组，也可能是约束名
  const target = (error as { meta?: { target?: unknown } } | null)?.meta
    ?.target;
  // 统一转为可搜索的文本
  return Array.isArray(target) ? target.join(',') : String(target ?? '');
}

// 补零到两位
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// 订单号时间戳：YYYYMMDDHHmmss（服务端本地时间，仅用于可读与唯一）
function formatOrderTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join('');
}

// 生成订单号：ZX + 14 位时间戳 + 4 位随机数
function generateOrderNo(): string {
  // 4 位随机数，降低同秒并发碰撞概率
  const random = Math.floor(Math.random() * 10000);
  return `ZX${formatOrderTimestamp(new Date())}${String(random).padStart(4, '0')}`;
}

// 订单行转为接口响应
function toOrderView(order: Order, courseName: string): OrderView {
  return {
    id: order.id,
    orderNo: order.orderNo,
    courseId: order.courseId,
    courseName,
    activityType: order.activityType,
    activityId: order.activityId,
    originalCents: order.originalCents,
    currentCents: order.currentCents,
    discountCents: order.discountCents,
    paidCents: order.paidCents,
    couponClaimId: order.couponClaimId,
    status: order.status,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
  };
}

// 订单服务：服务端计价下单、模拟支付、订单查询
@Injectable()
export class OrderService {
  // 构造函数：注入数据库、计价、券、幂等、支付网关、配置与支付后钩子
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly coupons: CouponUserService,
    private readonly idempotency: IdempotencyService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly config: ConfigService,
    @Inject(POST_PAYMENT_HANDLERS)
    private readonly handlers: PostPaymentHandler[],
    // 可选：未接入促销模块（如纯交易单测）时不回补秒杀库存
    @Optional()
    @Inject(FLASH_STOCK_RESTORE)
    private readonly restoreFlashStock?: FlashStockRestore,
  ) {}

  // 创建订单（幂等）：服务端定价后进入落库流程
  async createOrder(
    userId: number, // 下单用户
    dto: CreateOrderDto, // 下单参数（不含金额）
    idempotencyKey: string, // 幂等键
  ): Promise<OrderView> {
    // 幂等包裹：同键重放返回首次订单，不重复扣券/落库
    return this.idempotency.run(
      userId,
      idempotencyKey,
      ORDER_CREATE_ENDPOINT,
      async () => {
        // 活动类型默认普通购买
        const activityType: ActivityType = dto.activityType ?? 'normal';
        // 由对应策略校验活动并给出当前价
        const quote = await this.pricing.resolve(activityType).quote({
          courseId: dto.courseId,
          activityId: dto.activityId ?? null,
        });
        return this.createOrderWithQuote(userId, quote, dto, idempotencyKey);
      },
    );
  }

  // 【供步骤 08/09 复用】服务端报价已就绪时的下单入口（幂等由调用方负责）
  async createOrderWithQuote(
    userId: number, // 下单用户
    quote: PriceQuote, // 服务端报价
    dto: CreateOrderDto, // 下单参数
    _idempotencyKey: string, // 调用方幂等键（保留在契约中，便于追踪）
  ): Promise<OrderView> {
    // 课程必须存在且已发布（报价策略已校验，这里二次兜底防直接调用）
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
    });
    // 不存在或未发布统一按不可购买处理
    if (!course || course.status !== 'published') {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '课程已下架，不可购买',
        422,
      );
    }

    // 免费课程无需下单：兜底直接调用下单入口
    if (course.saleCents === 0) {
      throw new BizException(ErrorCode.PARAM_INVALID, '免费课程无需购买', 422);
    }

    // 券领取记录 id（未选券为 null）
    const couponClaimId = dto.couponClaimId ?? null;
    // 选券时执行完整可用性校验并取券额；未选券抵扣为 0
    const discountCents =
      couponClaimId === null
        ? 0
        : await this.pricing.couponDiscount(
            userId,
            dto.courseId,
            couponClaimId,
          );
    // 实付 = max(0, 当前价 − 券额)
    const paidCents = Math.max(0, quote.priceCents - discountCents);
    // 待支付超时（分钟）
    const ttlMinutes =
      this.config.get<number>('orderPendingTtlMinutes') ??
      DEFAULT_PENDING_TTL_MINUTES;
    // 待支付截止时间
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    // 订单号
    const orderNo = generateOrderNo();

    // 防重复购买键：同一用户同一课程只允许一笔有效订单
    const purchaseKey = `user:${userId}:course:${dto.courseId}`;
    // 秒杀限购键：仅秒杀活动订单非空
    const flashPurchaseKey =
      quote.activityType === 'flash_sale' && quote.activityId !== null
        ? `user:${userId}:flash:${quote.activityId}`
        : null;

    // 订单与券核销同事务：任一步失败整体回滚
    let order: Order;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        // 落库订单（purchaseKey 唯一约束兜底防重复购买）
        const created = await tx.order.create({
          data: {
            orderNo,
            userId,
            courseId: dto.courseId,
            activityType: quote.activityType,
            activityId: quote.activityId,
            originalCents: course.originalCents,
            currentCents: quote.priceCents,
            discountCents,
            paidCents,
            couponClaimId,
            purchaseKey,
            flashPurchaseKey,
            expiresAt,
          },
        });
        // 选券时在事务内核销：unused → used 并挂订单
        if (couponClaimId !== null) {
          await this.coupons.redeemInTx(tx, couponClaimId, userId, created.id);
        }
        return created;
      });
    } catch (error) {
      // 事务已回滚：按冲突键判定业务错误（Prisma 未给出 target 时回查兜底）
      throw await this.mapCreateError(error, {
        purchaseKey,
        flashPurchaseKey,
        couponClaimId,
      });
    }

    return toOrderView(order, course.name);
  }

  // 支付（幂等）：模拟网关扣款，事务内更新订单、写台账并执行支付后钩子
  async pay(userId: number, orderId: number): Promise<OrderView> {
    // 查询订单并带出课程名称（归属校验与响应都用得上）
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { course: { select: { name: true } } },
    });
    // 不存在或非本人订单统一 403，避免探测他人订单
    if (!order || order.userId !== userId) {
      throw new BizException(ErrorCode.FORBIDDEN, '无权访问该订单', 403);
    }
    // 已支付直接返回首次结果（幂等）
    if (order.status === 'paid') {
      return toOrderView(order, order.course.name);
    }
    // 仅待支付订单可支付
    if (order.status !== 'pending') {
      throw new BizException(ErrorCode.PARAM_INVALID, '订单不可支付', 422);
    }

    // 该活动类型的支付后处理器必须已注册
    const handler = this.handlers.find(
      (item) => item.activityType === order.activityType,
    );
    if (!handler) {
      throw new BizException(ErrorCode.INTERNAL_ERROR, '支付后处理未注册', 500);
    }

    // 调用支付网关（mock 恒成功；真实渠道在此外部扣款）
    const { transactionNo } = await this.gateway.charge(order);

    try {
      // 支付事务：订单状态、支付台账与活动副作用同生共死
      const paid = await this.prisma.$transaction(async (tx) => {
        // 订单置为已支付
        const updated = await tx.order.update({
          where: { id: orderId },
          data: { status: 'paid', paidAt: new Date() },
        });
        // 支付台账：渠道、流水号与实付金额
        await tx.payment.create({
          data: {
            orderId,
            channel: MOCK_PAYMENT_CHANNEL,
            transactionNo,
            amountCents: order.paidCents,
          },
        });
        // 支付后钩子：抛错则整个事务回滚
        await handler.onPaid(tx, updated);
        return updated;
      });
      return toOrderView(paid, order.course.name);
    } catch (error) {
      // 并发支付时 payments.orderId 唯一冲突：另一请求已完成，返回其已支付结果
      if (isUniqueConflict(error)) {
        const current = await this.prisma.order.findUnique({
          where: { id: orderId },
          include: { course: { select: { name: true } } },
        });
        if (current?.status === 'paid') {
          return toOrderView(current, current.course.name);
        }
      }
      // 支付事务已回滚：释放下单时预占的资源（秒杀库存），不覆盖原始错误
      try {
        await handler.onPaidFailed?.(order);
      } catch {
        // 回补失败交由后续重试/超时任务兜底，当前请求仍返回原始支付错误
      }
      throw error;
    }
  }

  // 订单详情：归属校验（含 IDOR 防护）
  async getOrder(userId: number, orderId: number): Promise<OrderView> {
    // 查询订单并带出课程名称
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { course: { select: { name: true } } },
    });
    // 不存在或非本人订单统一 403
    if (!order || order.userId !== userId) {
      throw new BizException(ErrorCode.FORBIDDEN, '无权访问该订单', 403);
    }
    return toOrderView(order, order.course.name);
  }

  // 我的订单分页：仅本人，按创建时间倒序
  async listUserOrders(
    userId: number, // 当前用户
    page: PageQuery, // 分页参数
  ): Promise<PageResult<OrderView>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 查询条件：仅本人订单
    const where = { userId };

    const [rows, total] = await Promise.all([
      // 当前页订单（带课程名称）
      this.prisma.order.findMany({
        where,
        include: { course: { select: { name: true } } },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      // 总条数
      this.prisma.order.count({ where }),
    ]);

    return {
      items: rows.map((row) => toOrderView(row, row.course.name)),
      total,
      page: pageNo,
      pageSize,
    };
  }

  // 全部订单分页（管理端）：联查课程与下单用户
  async listAllOrders(page: PageQuery): Promise<PageResult<AdminOrderView>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;

    const [rows, total] = await Promise.all([
      // 当前页订单（带课程名称与用户信息）
      this.prisma.order.findMany({
        include: {
          course: { select: { name: true } },
          user: { select: { id: true, email: true, nickname: true } },
        },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      // 总条数
      this.prisma.order.count(),
    ]);

    return {
      items: rows.map((row) => ({
        ...toOrderView(row, row.course.name),
        user: row.user,
      })),
      total,
      page: pageNo,
      pageSize,
    };
  }

  // 【供步骤 12 Worker 调用】取消超时未支付订单并释放占用的资源
  async cancelExpiredOrders(now: Date): Promise<number> {
    // 待支付且已过截止时间的订单
    const expired = await this.prisma.order.findMany({
      where: { status: 'pending', expiresAt: { lt: now } },
    });

    // 实际取消成功的订单数
    let cancelled = 0;
    for (const order of expired) {
      // 逐单事务：状态条件保证并发/重复扫描只处理一次
      const handled = await this.prisma.$transaction(async (tx) => {
        // 条件更新：订单仍为 pending 才取消，并释放限购键
        const { count } = await tx.order.updateMany({
          where: { id: order.id, status: 'pending' },
          data: {
            status: 'cancelled',
            purchaseKey: null,
            flashPurchaseKey: null,
          },
        });
        // 已被其他实例或用户支付处理则跳过
        if (count === 0) return false;
        // 秒杀订单：归还下单时预占的 Redis 库存
        if (
          order.activityType === 'flash_sale' &&
          order.activityId !== null &&
          this.restoreFlashStock
        ) {
          await this.restoreFlashStock(order.activityId);
        }
        // 使用过的券恢复为可用（used → restored）
        if (order.couponClaimId !== null) {
          await this.coupons.restoreInTx(tx, order.couponClaimId);
        }
        return true;
      });
      if (handled) cancelled += 1;
    }

    return cancelled;
  }

  // 唯一冲突转为业务错误：优先用 Prisma 给出的冲突字段，缺失时回查订单表兜底
  private async mapCreateError(
    error: unknown, // 事务抛出的原始异常
    keys: {
      purchaseKey: string; // 本次下单的防重复购买键
      flashPurchaseKey: string | null; // 本次下单的秒杀限购键
      couponClaimId: number | null; // 本次下单使用的券领取记录 id
    },
  ): Promise<unknown> {
    // 非唯一冲突不处理
    if (!isUniqueConflict(error)) return error;
    // 冲突字段/索引名
    const target = uniqueTargetText(error);
    // 防重复购买/秒杀限购冲突
    if (target.includes('purchaseKey') || target.includes('flashPurchaseKey')) {
      return new BizException(
        ErrorCode.DUPLICATE_PURCHASE,
        '您已购买过该课程',
        409,
      );
    }
    // 同一张券被并发订单占用
    if (target.includes('couponClaimId')) {
      return new BizException(
        ErrorCode.COUPON_UNAVAILABLE,
        '优惠券不可用',
        422,
      );
    }
    // Prisma 未能给出冲突字段（如 PostgreSQL 18）：回查判定
    if (target !== '') return error;
    // 已存在相同购买键的订单 → 重复购买
    if (await this.hasPurchaseConflict(keys)) {
      return new BizException(
        ErrorCode.DUPLICATE_PURCHASE,
        '您已购买过该课程',
        409,
      );
    }
    // 券已被其他订单占用
    if (
      keys.couponClaimId !== null &&
      (await this.hasCouponConflict(keys.couponClaimId))
    ) {
      return new BizException(
        ErrorCode.COUPON_UNAVAILABLE,
        '优惠券不可用',
        422,
      );
    }
    // 其他唯一冲突（如订单号碰撞）保持原样，由上层按内部错误处理
    return error;
  }

  // 是否已存在相同购买键的订单（事务回滚后查询，兼容缺失冲突字段的驱动）
  private async hasPurchaseConflict(keys: {
    purchaseKey: string; // 本次下单的防重复购买键
    flashPurchaseKey: string | null; // 本次下单的秒杀限购键
  }): Promise<boolean> {
    // 秒杀订单额外匹配限购键，其余订单仅匹配购买键
    const where =
      keys.flashPurchaseKey === null
        ? { purchaseKey: keys.purchaseKey }
        : {
            OR: [
              { purchaseKey: keys.purchaseKey },
              { flashPurchaseKey: keys.flashPurchaseKey },
            ],
          };
    // 仅需判断是否存在
    const existing = await this.prisma.order.findFirst({
      where,
      select: { id: true },
    });
    return existing !== null;
  }

  // 指定券领取记录是否已被订单占用
  private async hasCouponConflict(couponClaimId: number): Promise<boolean> {
    // 券与订单为 1:1，存在即冲突
    const existing = await this.prisma.order.findFirst({
      where: { couponClaimId },
      select: { id: true },
    });
    return existing !== null;
  }
}
