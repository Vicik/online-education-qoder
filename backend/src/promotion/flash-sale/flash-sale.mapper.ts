import type {
  FlashSaleActivity,
  FlashSaleActivityStatus,
} from '@prisma/client';

// 秒杀活动视图：openapi FlashSaleActivityBrief 的字段，另补 version（管理端编辑）与 remaining（服务端剩余）
export interface FlashSaleActivityView {
  id: number; // 活动 id
  courseId: number; // 关联课程 id
  courseName: string; // 关联课程名称
  name: string; // 活动名称
  priceCents: number; // 秒杀价（分）
  stock: number; // 总库存
  sold: number; // 已支付售出数量
  remaining: number; // 剩余可购数量（用户端取 Redis 预占后的值）
  startAt: Date; // 开始时间（ISO UTC，前端按 Asia/Shanghai 渲染）
  endAt: Date; // 结束时间（倒计时依据）
  status: FlashSaleActivityStatus; // 活动状态
  version: number; // 乐观锁版本号（管理端编辑时回传）
}

// 活动及其课程的联查结果
export type FlashSaleActivityWithCourse = FlashSaleActivity & {
  course: { name: string }; // 课程名称（联查字段）
};

// 活动行转为接口视图
export function toFlashSaleActivityView(
  activity: FlashSaleActivityWithCourse,
  remaining: number,
): FlashSaleActivityView {
  return {
    id: activity.id,
    courseId: activity.courseId,
    courseName: activity.course.name,
    name: activity.name,
    priceCents: activity.priceCents,
    stock: activity.stock,
    sold: activity.sold,
    remaining,
    startAt: activity.startAt,
    endAt: activity.endAt,
    status: activity.status,
    version: activity.version,
  };
}
