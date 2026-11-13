import { Inject, Injectable } from '@nestjs/common';
import { GrouponActivity, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import { PageQuery } from '../../common/dto/page-query.dto';
import { PageResult } from '../../common/dto/page-result';
import { BizException } from '../../common/exceptions/biz.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { OrderService, OrderView } from '../../trade/order/order.service';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from '../../trade/payment/payment-gateway.interface';
import { PricingService } from '../../trade/pricing/pricing.service';
import {
  GrouponActivityBrief,
  GrouponActivityWithCourse,
  GrouponGroupView,
  MyGrouponItem,
  toActivityBrief,
  toGrouponOrderView,
  toGroupView,
} from './groupon.mapper';

// 开团/参团的返回结构：团组视图 + 待支付订单
export interface GrouponOrderResult {
  group: GrouponGroupView; // 团组信息（含 targetSize）
  order: OrderView; // 参与者订单
}

// 判断错误是否为 Prisma 唯一约束冲突（P2002）
function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

// 拼团活动是否可参与：进行中且在有效期内
function isActivityJoinable(activity: GrouponActivity, now: Date): boolean {
  return (
    activity.status === 'ongoing' && activity.endAt.getTime() > now.getTime()
  );
}

// 用户端拼团服务：活动浏览、开团/参团、我的拼团与到期失败退款
@Injectable()
export class GrouponUserService {
  // 构造函数：注入数据库、订单、计价、幂等与支付网关
  constructor(
    private readonly prisma: PrismaService, // 数据库访问
    private readonly orders: OrderService, // 订单创建入口
    private readonly pricing: PricingService, // 服务端计价
    private readonly idempotency: IdempotencyService, // 开团/参团幂等
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway, // 退款网关
    private readonly storage: StorageService, // 课程封面地址解析
  ) {}

  // 进行中的活动列表（公开）
  async listActivities(
    page: PageQuery,
  ): Promise<PageResult<GrouponActivityBrief>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 仅展示进行中且未结束的活动
    const where: Prisma.GrouponActivityWhereInput = {
      status: 'ongoing',
      endAt: { gt: new Date() },
    };

    const [rows, total] = await Promise.all([
      // 当前页活动（带课程名称、封面与原价，供卡片展示）
      this.prisma.grouponActivity.findMany({
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
      this.prisma.grouponActivity.count({ where }),
    ]);

    // 封面 key 异步解析为公开地址
    const items = await Promise.all(rows.map((row) => this.toPublicBrief(row)));

    return { items, total, page: pageNo, pageSize };
  }

  // 活动详情：附带待成团团组（公开）
  async getActivity(
    activityId: number,
  ): Promise<GrouponActivityBrief & { groups: GrouponGroupView[] }> {
    // 活动必须存在（带课程封面与原价，供详情页展示）
    const activity = await this.prisma.grouponActivity.findUnique({
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
        '拼团活动不存在',
        404,
      );
    }
    // 仅展示待成团的团组，供用户选择加入；团长取最早加入的成员
    const groups = await this.prisma.grouponGroup.findMany({
      where: { activityId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      include: {
        members: {
          orderBy: { joinedAt: 'asc' },
          take: 1,
          select: { user: { select: { nickname: true } } },
        },
      },
    });

    return {
      ...(await this.toPublicBrief(activity)),
      groups: groups.map((group) =>
        toGroupView(
          group,
          activity.targetSize,
          group.members[0]?.user.nickname ?? null,
        ),
      ),
    };
  }

  // 活动摘要补充用户端展示字段：课程封面公开地址与课程原价
  private async toPublicBrief(
    row: GrouponActivityWithCourse,
  ): Promise<GrouponActivityBrief> {
    return {
      ...toActivityBrief(row),
      courseCoverUrl: await this.storage.resolveUrl(row.course.coverUrl),
      courseOriginalCents: row.course.originalCents,
    };
  }

  // 开团：活动进行中；发起者成为首成员；生成待支付订单（幂等）
  async createGroup(
    userId: number,
    activityId: number,
    idempotencyKey: string,
  ): Promise<GrouponOrderResult> {
    // 幂等端点包含活动 id，避免同一幂等键跨活动命中错误结果
    return this.idempotency.run(
      userId,
      idempotencyKey,
      `POST /groupons/${activityId}/groups`,
      async () => {
        // 活动必须存在
        const activity = await this.prisma.grouponActivity.findUnique({
          where: { id: activityId },
        });
        if (!activity) {
          throw new BizException(
            ErrorCode.RESOURCE_NOT_FOUND,
            '拼团活动不存在',
            404,
          );
        }
        // 仅进行中且在有效期内的活动可开团
        if (!isActivityJoinable(activity, new Date())) {
          throw new BizException(
            ErrorCode.ACTIVITY_NOT_STARTED,
            '拼团活动未开始或已结束',
            422,
          );
        }
        // 同一活动一人一次：提前拦截，避免产生无主订单
        await this.assertNotJoined(activityId, userId);

        // 服务端计价：拼团价来自活动
        const quote = await this.pricing.resolve('groupon').quote({
          courseId: activity.courseId,
          activityId,
        });
        // 先在交易领域创建待支付订单（内部自带事务）
        const order = await this.orders.createOrderWithQuote(
          userId,
          quote,
          {
            courseId: activity.courseId,
            activityType: 'groupon',
            activityId: null,
          },
          idempotencyKey,
        );

        // 团组、成员与订单回写同事务：任一步失败整体回滚
        const result = await this.prisma
          .$transaction(async (tx) => {
            // 新建待成团团组，截止时间与活动一致
            const group = await tx.grouponGroup.create({
              data: {
                activityId,
                status: 'pending',
                memberCount: 0,
                expiresAt: activity.endAt,
              },
            });
            // 发起者自动成为首成员
            await tx.grouponMember.create({
              data: {
                groupId: group.id,
                activityId,
                userId,
                orderId: order.id,
              },
            });
            // 订单 activityId 回写为团组 id（schema 约定）
            await tx.order.update({
              where: { id: order.id },
              data: { activityId: group.id },
            });
            return { group, order: { ...order, activityId: group.id } };
          })
          .catch((error: unknown) => {
            // 并发下 (activityId,userId) 唯一冲突：另一请求已参与
            if (isUniqueConflict(error)) {
              throw new BizException(
                ErrorCode.GROUP_FULL,
                '您已参与过该拼团活动',
                409,
              );
            }
            throw error;
          });

        return {
          group: toGroupView(result.group, activity.targetSize),
          order: result.order,
        };
      },
    );
  }

  // 参团：团组待成团且未满；生成待支付订单（幂等）
  async joinGroup(
    userId: number,
    activityId: number,
    groupId: number,
    idempotencyKey: string,
  ): Promise<GrouponOrderResult> {
    // 幂等端点包含活动与团组 id
    return this.idempotency.run(
      userId,
      idempotencyKey,
      `POST /groupons/${activityId}/groups/${groupId}/join`,
      async () => {
        // 团组必须存在且属于该活动
        const group = await this.prisma.grouponGroup.findUnique({
          where: { id: groupId },
        });
        if (!group || group.activityId !== activityId) {
          throw new BizException(
            ErrorCode.RESOURCE_NOT_FOUND,
            '团组不存在',
            404,
          );
        }
        // 已成团/已失败/已满的团不可加入
        if (group.status !== 'pending') {
          throw new BizException(ErrorCode.GROUP_FULL, '该团已满或已结束', 422);
        }
        // 活动必须仍可参与
        const activity = await this.prisma.grouponActivity.findUnique({
          where: { id: activityId },
        });
        if (!activity || !isActivityJoinable(activity, new Date())) {
          throw new BizException(
            ErrorCode.ACTIVITY_NOT_STARTED,
            '拼团活动未开始或已结束',
            422,
          );
        }
        // 同一活动一人一次：提前拦截
        await this.assertNotJoined(activityId, userId);
        // 名额预检查（最终以支付时的行锁计团为准）
        if (group.memberCount >= activity.targetSize) {
          throw new BizException(ErrorCode.GROUP_FULL, '该团已满', 422);
        }

        // 服务端计价与下单
        const quote = await this.pricing.resolve('groupon').quote({
          courseId: activity.courseId,
          activityId,
        });
        const order = await this.orders.createOrderWithQuote(
          userId,
          quote,
          {
            courseId: activity.courseId,
            activityType: 'groupon',
            activityId: null,
          },
          idempotencyKey,
        );

        try {
          // 成员与订单回写同事务
          await this.prisma.$transaction(async (tx) => {
            await tx.grouponMember.create({
              data: {
                groupId,
                activityId,
                userId,
                orderId: order.id,
              },
            });
            await tx.order.update({
              where: { id: order.id },
              data: { activityId: groupId },
            });
          });
        } catch (error) {
          // 并发下 (activityId,userId) 唯一冲突：另一请求已参与
          if (isUniqueConflict(error)) {
            throw new BizException(
              ErrorCode.GROUP_FULL,
              '您已参与过该拼团活动',
              409,
            );
          }
          throw error;
        }

        return {
          group: toGroupView(group, activity.targetSize),
          order: { ...order, activityId: groupId },
        };
      },
    );
  }

  // 我的拼团：团组、活动与订单信息分页
  async listMine(
    userId: number,
    page: PageQuery,
  ): Promise<PageResult<MyGrouponItem>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 查询条件：本人成员记录
    const where: Prisma.GrouponMemberWhereInput = { userId };

    const [rows, total] = await Promise.all([
      // 成员记录（带团组、活动与订单）
      this.prisma.grouponMember.findMany({
        where,
        include: {
          group: {
            include: {
              activity: { include: { course: { select: { name: true } } } },
            },
          },
          order: { include: { course: { select: { name: true } } } },
        },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { joinedAt: 'desc' },
      }),
      // 总数
      this.prisma.grouponMember.count({ where }),
    ]);

    return {
      items: rows.map((member) => ({
        activity: toActivityBrief(member.group.activity),
        group: toGroupView(member.group, member.group.activity.targetSize),
        order: toGrouponOrderView(member.order),
        status: member.group.status,
      })),
      total,
      page: pageNo,
      pageSize,
    };
  }

  // 【供步骤 12 Worker】到期未满的团失败退款：团组、订单、支付台账与券同事务
  async failExpiredGroups(now: Date): Promise<number> {
    // 待成团且已过截止时间的团组
    const expired = await this.prisma.grouponGroup.findMany({
      where: { status: 'pending', expiresAt: { lt: now } },
      select: { id: true },
    });

    // 实际处理成功的团组数
    let processed = 0;
    for (const group of expired) {
      // 逐团事务：状态条件保证并发/重复扫描下只处理一次
      const handled = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.grouponGroup.updateMany({
          where: { id: group.id, status: 'pending' },
          data: { status: 'failed' },
        });
        // 已被其他实例处理则跳过
        if (count === 0) return false;

        // 成员及其订单
        const members = await tx.grouponMember.findMany({
          where: { groupId: group.id },
          include: { order: true },
        });

        for (const member of members) {
          const order = member.order;
          // 仅已支付订单需要退款
          if (order.status !== 'paid') continue;

          // 已支付订单必有台账：调用网关退款并翻转台账状态
          const payment = await tx.payment.findUnique({
            where: { orderId: order.id },
          });
          if (payment && payment.status !== 'refunded') {
            await this.gateway.refund(order, payment);
            // payments 与订单 1:1，退款在本行上流转（orderId 唯一）
            await tx.payment.update({
              where: { orderId: order.id },
              data: { status: 'refunded', refundedAt: now },
            });
          }

          // 订单退款：置空限购键，允许用户重新购买
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: 'refunded',
              purchaseKey: null,
              flashPurchaseKey: null,
            },
          });

          // 核销过的券恢复为可用
          if (order.couponClaimId !== null) {
            await tx.couponClaim.update({
              where: { id: order.couponClaimId },
              data: { status: 'restored' },
            });
          }
        }

        return true;
      });

      if (handled) processed += 1;
    }

    return processed;
  }

  // 同一活动一人一次：存在成员记录即视为已参与
  private async assertNotJoined(
    activityId: number,
    userId: number,
  ): Promise<void> {
    const existing = await this.prisma.grouponMember.findFirst({
      where: { activityId, userId },
      select: { id: true },
    });
    if (existing) {
      throw new BizException(ErrorCode.GROUP_FULL, '您已参与过该拼团活动', 409);
    }
  }
}
