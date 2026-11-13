import type {
  GrouponActivity,
  GrouponActivityStatus,
  GrouponGroup,
  GrouponGroupStatus,
  Order,
  OrderStatus,
} from '@prisma/client';

// 拼团活动摘要：与 openapi GrouponActivityBrief 一致
export interface GrouponActivityBrief {
  id: number; // 活动 id
  courseId: number; // 关联课程 id
  courseName: string; // 关联课程名称
  name: string; // 活动名称
  priceCents: number; // 拼团价（分）
  targetSize: number; // 成团人数
  startAt: Date; // 开始时间
  endAt: Date; // 结束时间
  status: GrouponActivityStatus; // 活动状态
  version: number; // 乐观锁版本号（管理端编辑时回传）
  courseCoverUrl?: string | null; // 课程封面展示地址（用户端列表补充）
  courseOriginalCents?: number; // 课程原价（分，用户端列表补充）
}

// 团组视图：与 openapi GrouponGroup 一致（targetSize 来自所属活动）
export interface GrouponGroupView {
  id: number; // 团组 id
  status: GrouponGroupStatus; // 团组状态
  memberCount: number; // 已计入的成员数（支付成功才计入）
  targetSize: number; // 成团人数
  expiresAt: Date; // 团组截止时间（= 活动 endAt）
  formedAt: Date | null; // 成团时间
  leaderNickname?: string | null; // 团长昵称（公开详情补充）
}

// 拼团订单摘要：与 openapi Order 一致
export interface GrouponOrderView {
  id: number; // 订单 id
  orderNo: string; // 订单号
  courseId: number; // 课程 id
  courseName: string; // 课程名称
  activityType: 'groupon'; // 活动类型固定为拼团
  activityId: number | null; // 团组 id
  originalCents: number; // 课程原价（分）
  currentCents: number; // 当前价（拼团价，分）
  discountCents: number; // 券抵扣额（分）
  paidCents: number; // 实付（分）
  couponClaimId: number | null; // 使用的券领取记录 id
  status: OrderStatus; // 订单状态
  paidAt: Date | null; // 支付时间
  createdAt: Date; // 创建时间
}

// 我的拼团记录项：openapi /user/groupons 的 items 结构
export interface MyGrouponItem {
  activity: GrouponActivityBrief; // 所属活动
  group: GrouponGroupView; // 团组信息
  order: GrouponOrderView; // 成员订单
  status: GrouponGroupStatus; // 团组状态（列表主状态）
}

// 活动及其课程的联查结果：用户端列表额外带封面与原价
export type GrouponActivityWithCourse = GrouponActivity & {
  course: {
    name: string; // 课程名称（联查字段）
    coverUrl?: string | null; // 封面 key（用户端列表补齐）
    originalCents?: number; // 课程原价（分，用户端列表补齐）
  };
};

// 订单及其课程的联查结果
export type GrouponOrderWithCourse = Order & {
  course: { name: string }; // 课程名称（联查字段）
};

// 活动行转为接口摘要
export function toActivityBrief(
  activity: GrouponActivityWithCourse,
): GrouponActivityBrief {
  return {
    id: activity.id,
    courseId: activity.courseId,
    courseName: activity.course.name,
    name: activity.name,
    priceCents: activity.priceCents,
    targetSize: activity.targetSize,
    startAt: activity.startAt,
    endAt: activity.endAt,
    status: activity.status,
    version: activity.version,
  };
}

// 团组行转为接口视图：targetSize 冗余自所属活动，团长昵称仅公开详情传入
export function toGroupView(
  group: GrouponGroup,
  targetSize: number,
  leaderNickname?: string | null,
): GrouponGroupView {
  return {
    id: group.id,
    status: group.status,
    memberCount: group.memberCount,
    targetSize,
    expiresAt: group.expiresAt,
    formedAt: group.formedAt,
    leaderNickname: leaderNickname ?? null,
  };
}

// 订单行转为拼团订单视图
export function toGrouponOrderView(
  order: GrouponOrderWithCourse,
): GrouponOrderView {
  return {
    id: order.id,
    orderNo: order.orderNo,
    courseId: order.courseId,
    courseName: order.course.name,
    activityType: 'groupon',
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
