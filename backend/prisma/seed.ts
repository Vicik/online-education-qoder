// 幂等种子脚本：全部写操作使用 upsert，重复执行不产生重复数据。
// prod 环境（SEED_DEMO_DATA=false 且 NODE_ENV=production）跳过，演示账号仅注入 dev/staging/CI。
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { authenticator } from "otplib";
import { loadConfig } from "../src/config/configuration";
import {
  COUPON_TEMPLATE,
  COURSE_TYPESCRIPT,
  COURSE_WRITING,
  DEMO_ADMIN,
  DEMO_USER,
  FLASH_SALE_ACTIVITY,
  GROUPON_ACTIVITY,
  GROUPON_GROUP_ONE_SHORT,
} from "./seed-data";

// 「仅差一人」演示团组订单的固定订单号（幂等 upsert 依据）
const DEMO_GROUPON_ORDER_NO = "GRP-DEMO-0001";
// 「仅差一人」演示团组订单的固定支付流水号
const DEMO_GROUPON_TRANSACTION_NO = "MOCK-SEED-GRP-0001";
// 上海时区相对 UTC 的固定偏移（毫秒，无夏令时）
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
// 一小时毫秒数
const HOUR_MS = 60 * 60 * 1000;
// 一天毫秒数
const DAY_MS = 24 * HOUR_MS;
// 默认 bcrypt 成本因子（D10 要求 cost≥12）
const DEFAULT_BCRYPT_COST = 12;

// 计算「下一个 12 月 1 日 00:00（Asia/Shanghai）」对应的 UTC 时间：
// 本年的 12 月 1 日已过则顺延到下一年，保证种子在任何月份执行时活动都处于「未开始」
function nextDecemberFirstUtc(now: Date): Date {
  // 按上海时区确定当前年份
  const shanghaiYear = new Date(
    now.getTime() + SHANGHAI_OFFSET_MS,
  ).getUTCFullYear();
  // Date.UTC 得到 UTC 零点，再减去 8 小时得到上海零点的对应 UTC 时刻
  const thisYear = new Date(Date.UTC(shanghaiYear, 11, 1) - SHANGHAI_OFFSET_MS);
  return thisYear > now
    ? thisYear
    : new Date(Date.UTC(shanghaiYear + 1, 11, 1) - SHANGHAI_OFFSET_MS);
}

// 写入全部演示数据（幂等）；bcryptCost 可注入以便测试
export async function seedDemoData(
  prisma: PrismaClient,
  bcryptCost: number = DEFAULT_BCRYPT_COST,
): Promise<void> {
  // 种子执行时刻，所有相对时间以此为基准
  const now = new Date();

  // 并行生成两个演示账号的密码哈希
  const [adminPasswordHash, userPasswordHash] = await Promise.all([
    bcrypt.hash(DEMO_ADMIN.password, bcryptCost),
    bcrypt.hash(DEMO_USER.password, bcryptCost),
  ]);

  // 管理员账号：按 email 幂等，已存在时不重置密码
  const admin = await prisma.user.upsert({
    where: { email: DEMO_ADMIN.email },
    create: {
      email: DEMO_ADMIN.email, // 登录邮箱
      passwordHash: adminPasswordHash, // 密码哈希
      nickname: DEMO_ADMIN.nickname, // 昵称
      role: DEMO_ADMIN.role, // admin
      status: "active", // 启用
    },
    update: {},
  });

  // 管理员 TOTP 密钥：仅缺失时生成，保证种子重复执行不重置已有密钥
  let adminTotpSecret = admin.totpSecret;
  if (!adminTotpSecret) {
    // 随机生成 Base32 密钥
    adminTotpSecret = authenticator.generateSecret();
    // 写入管理员账号
    await prisma.user.update({
      where: { id: admin.id },
      data: { totpSecret: adminTotpSecret },
    });
    // otpauth URI：dev 控制台扫码绑定（无需在日志中输出密钥本身）
    const adminTotpUri = authenticator.keyuri(
      admin.email,
      "知序课堂",
      adminTotpSecret,
    );
    console.log(`管理员 TOTP 已生成：${adminTotpUri}`);
  }

  // 学员账号：按 email 幂等，已存在时不重置密码
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER.email },
    create: {
      email: DEMO_USER.email, // 登录邮箱
      passwordHash: userPasswordHash, // 密码哈希
      nickname: DEMO_USER.nickname, // 昵称
      role: DEMO_USER.role, // user
      status: "active", // 启用
    },
    update: {},
  });

  // 已发布视频课：按固定 id 幂等
  await prisma.course.upsert({
    where: { id: COURSE_TYPESCRIPT.id },
    create: {
      id: COURSE_TYPESCRIPT.id, // 固定课程 id
      name: COURSE_TYPESCRIPT.name, // 课程名称
      type: COURSE_TYPESCRIPT.type, // video
      instructor: COURSE_TYPESCRIPT.instructor, // 讲师
      originalCents: COURSE_TYPESCRIPT.originalCents, // 原价
      saleCents: COURSE_TYPESCRIPT.saleCents, // 售价
      status: COURSE_TYPESCRIPT.status, // published
      intro: COURSE_TYPESCRIPT.intro, // 简介
      detailRich: COURSE_TYPESCRIPT.detailRich, // 详情富文本
    },
    update: {
      name: COURSE_TYPESCRIPT.name, // 课程名称
      type: COURSE_TYPESCRIPT.type, // video
      instructor: COURSE_TYPESCRIPT.instructor, // 讲师
      originalCents: COURSE_TYPESCRIPT.originalCents, // 原价
      saleCents: COURSE_TYPESCRIPT.saleCents, // 售价
      status: COURSE_TYPESCRIPT.status, // published
      intro: COURSE_TYPESCRIPT.intro, // 简介
      detailRich: COURSE_TYPESCRIPT.detailRich, // 详情富文本
    },
  });

  // 视频课章节：按 (courseId, sortOrder) 幂等，sortOrder 从 1 连续编号
  for (const [index, chapter] of COURSE_TYPESCRIPT.chapters.entries()) {
    // 章节序号
    const sortOrder = index + 1;
    await prisma.chapter.upsert({
      where: {
        courseId_sortOrder: { courseId: COURSE_TYPESCRIPT.id, sortOrder },
      },
      create: {
        courseId: COURSE_TYPESCRIPT.id, // 所属课程
        title: chapter.title, // 章节标题
        contentType: COURSE_TYPESCRIPT.type, // 与课程类型一致：video
        content: chapter.content, // 对象存储 key
        sortOrder, // 章节序号
      },
      update: {
        title: chapter.title, // 章节标题
        contentType: COURSE_TYPESCRIPT.type, // 与课程类型一致：video
        content: chapter.content, // 对象存储 key
      },
    });
  }

  // 草稿图文课：按固定 id 幂等
  await prisma.course.upsert({
    where: { id: COURSE_WRITING.id },
    create: {
      id: COURSE_WRITING.id, // 固定课程 id
      name: COURSE_WRITING.name, // 课程名称
      type: COURSE_WRITING.type, // rich
      instructor: COURSE_WRITING.instructor, // 讲师
      originalCents: COURSE_WRITING.originalCents, // 原价
      saleCents: COURSE_WRITING.saleCents, // 售价
      status: COURSE_WRITING.status, // draft
    },
    update: {
      name: COURSE_WRITING.name, // 课程名称
      type: COURSE_WRITING.type, // rich
      instructor: COURSE_WRITING.instructor, // 讲师
      originalCents: COURSE_WRITING.originalCents, // 原价
      saleCents: COURSE_WRITING.saleCents, // 售价
      status: COURSE_WRITING.status, // draft
    },
  });

  // 拼团活动与演示团组共用的结束时间（团组 expiresAt = 活动 endAt）
  const grouponEndAt = new Date(now.getTime() + 3 * HOUR_MS);

  // 进行中的双人拼团活动：startAt = now-1h，endAt = now+3h
  await prisma.grouponActivity.upsert({
    where: { id: GROUPON_ACTIVITY.id },
    create: {
      id: GROUPON_ACTIVITY.id, // 固定活动 id
      courseId: COURSE_TYPESCRIPT.id, // 关联已发布课程
      name: GROUPON_ACTIVITY.name, // 活动名称
      priceCents: GROUPON_ACTIVITY.priceCents, // 拼团价
      targetSize: GROUPON_ACTIVITY.targetSize, // 成团人数
      startAt: new Date(now.getTime() - HOUR_MS), // 一小时前开始
      endAt: grouponEndAt, // 三小时后结束
      status: "ongoing", // 进行中
    },
    update: {
      courseId: COURSE_TYPESCRIPT.id, // 关联已发布课程
      name: GROUPON_ACTIVITY.name, // 活动名称
      priceCents: GROUPON_ACTIVITY.priceCents, // 拼团价
      targetSize: GROUPON_ACTIVITY.targetSize, // 成团人数
      startAt: new Date(now.getTime() - HOUR_MS), // 一小时前开始
      endAt: grouponEndAt, // 三小时后结束
      status: "ongoing", // 进行中
    },
  });

  // 未开始的秒杀活动：本年 12 月 1 日 00:00（上海）开始，持续 24 小时
  const flashStartAt = nextDecemberFirstUtc(now);
  const flashEndAt = new Date(flashStartAt.getTime() + DAY_MS);
  await prisma.flashSaleActivity.upsert({
    where: { id: FLASH_SALE_ACTIVITY.id },
    create: {
      id: FLASH_SALE_ACTIVITY.id, // 固定活动 id
      courseId: COURSE_TYPESCRIPT.id, // 关联已发布课程
      name: FLASH_SALE_ACTIVITY.name, // 活动名称
      priceCents: FLASH_SALE_ACTIVITY.priceCents, // 秒杀价
      stock: FLASH_SALE_ACTIVITY.stock, // 库存
      sold: FLASH_SALE_ACTIVITY.sold, // 已售
      startAt: flashStartAt, // 开始时间
      endAt: flashEndAt, // 结束时间
      status: "not_started", // 未开始
    },
    update: {
      courseId: COURSE_TYPESCRIPT.id, // 关联已发布课程
      name: FLASH_SALE_ACTIVITY.name, // 活动名称
      priceCents: FLASH_SALE_ACTIVITY.priceCents, // 秒杀价
      stock: FLASH_SALE_ACTIVITY.stock, // 库存（不重置已售，避免覆盖并发扣减结果）
      startAt: flashStartAt, // 开始时间
      endAt: flashEndAt, // 结束时间
      status: "not_started", // 未开始
    },
  });

  // 新学员立减券模板：now-1d 至 now+30d，总量 1000，每人限 1 张
  await prisma.couponTemplate.upsert({
    where: { id: COUPON_TEMPLATE.id },
    create: {
      id: COUPON_TEMPLATE.id, // 固定模板 id
      name: COUPON_TEMPLATE.name, // 模板名称
      discountCents: COUPON_TEMPLATE.discountCents, // 面额
      startAt: new Date(now.getTime() - DAY_MS), // 一天前生效
      endAt: new Date(now.getTime() + 30 * DAY_MS), // 三十天后失效
      totalQty: 1000, // 发放总量
      perUserLimit: 1, // 每人限领 1 张
      status: "enabled", // 已启用
    },
    update: {
      name: COUPON_TEMPLATE.name, // 模板名称
      discountCents: COUPON_TEMPLATE.discountCents, // 面额
      startAt: new Date(now.getTime() - DAY_MS), // 一天前生效
      endAt: new Date(now.getTime() + 30 * DAY_MS), // 三十天后失效
      totalQty: 1000, // 发放总量
      perUserLimit: 1, // 每人限领 1 张
      status: "enabled", // 已启用（不重置 claimedCount）
    },
  });

  // 券模板适用课程：按复合主键幂等，挂在已发布视频课上
  await prisma.couponTemplateCourse.upsert({
    where: {
      templateId_courseId: {
        templateId: COUPON_TEMPLATE.id,
        courseId: COURSE_TYPESCRIPT.id,
      },
    },
    create: {
      templateId: COUPON_TEMPLATE.id, // 券模板
      courseId: COURSE_TYPESCRIPT.id, // 适用课程
    },
    update: {},
  });

  // 「仅差一人」团组：1/2 成员，待成团
  await prisma.grouponGroup.upsert({
    where: { id: GROUPON_GROUP_ONE_SHORT.id },
    create: {
      id: GROUPON_GROUP_ONE_SHORT.id, // 固定团组 id
      activityId: GROUPON_ACTIVITY.id, // 所属活动
      status: "pending", // 待成团
      memberCount: 1, // 已有一人
      expiresAt: grouponEndAt, // 与活动 endAt 一致
    },
    update: {
      activityId: GROUPON_ACTIVITY.id, // 所属活动
      status: "pending", // 待成团
      memberCount: 1, // 已有一人
      formedAt: null, // 未成团
      expiresAt: grouponEndAt, // 与活动 endAt 一致
    },
  });

  // 团组成员的已支付订单：按固定订单号幂等
  const grouponOrder = await prisma.order.upsert({
    where: { orderNo: DEMO_GROUPON_ORDER_NO },
    create: {
      orderNo: DEMO_GROUPON_ORDER_NO, // 固定订单号
      userId: user.id, // 学员账号
      courseId: COURSE_TYPESCRIPT.id, // 课程
      activityType: "groupon", // 拼团订单
      activityId: GROUPON_GROUP_ONE_SHORT.id, // 团组 id
      originalCents: COURSE_TYPESCRIPT.originalCents, // 原价
      currentCents: GROUPON_ACTIVITY.priceCents, // 拼团价
      discountCents: 0, // 未用券
      paidCents: GROUPON_ACTIVITY.priceCents, // 实付 = 拼团价
      couponClaimId: null, // 未核销券
      status: "paid", // 已支付
      paidAt: now, // 支付时间
      expiresAt: null, // 已支付订单无待支付超时
      purchaseKey: `user:${user.id}:course:${COURSE_TYPESCRIPT.id}`, // 防重复购买键
      flashPurchaseKey: null, // 非秒杀订单
    },
    update: {
      userId: user.id, // 学员账号
      courseId: COURSE_TYPESCRIPT.id, // 课程
      activityType: "groupon", // 拼团订单
      activityId: GROUPON_GROUP_ONE_SHORT.id, // 团组 id
      originalCents: COURSE_TYPESCRIPT.originalCents, // 原价
      currentCents: GROUPON_ACTIVITY.priceCents, // 拼团价
      discountCents: 0, // 未用券
      paidCents: GROUPON_ACTIVITY.priceCents, // 实付 = 拼团价
      couponClaimId: null, // 未核销券
      status: "paid", // 已支付
      paidAt: now, // 支付时间
      expiresAt: null, // 已支付订单无待支付超时
      purchaseKey: `user:${user.id}:course:${COURSE_TYPESCRIPT.id}`, // 防重复购买键
      flashPurchaseKey: null, // 非秒杀订单
    },
  });

  // 订单对应的模拟支付成功记录：按固定流水号幂等
  await prisma.payment.upsert({
    where: { transactionNo: DEMO_GROUPON_TRANSACTION_NO },
    create: {
      orderId: grouponOrder.id, // 所属订单
      channel: "mock", // 模拟支付渠道
      transactionNo: DEMO_GROUPON_TRANSACTION_NO, // 固定流水号
      amountCents: GROUPON_ACTIVITY.priceCents, // 支付金额
      status: "success", // 支付成功
      paidAt: now, // 支付时间
    },
    update: {
      orderId: grouponOrder.id, // 所属订单
      channel: "mock", // 模拟支付渠道
      amountCents: GROUPON_ACTIVITY.priceCents, // 支付金额
      status: "success", // 支付成功
      paidAt: now, // 支付时间
      refundedAt: null, // 种子订单不退款
    },
  });

  // 团组成员：按 (groupId, userId) 幂等
  await prisma.grouponMember.upsert({
    where: {
      groupId_userId: {
        groupId: GROUPON_GROUP_ONE_SHORT.id,
        userId: user.id,
      },
    },
    create: {
      groupId: GROUPON_GROUP_ONE_SHORT.id, // 所属团组
      activityId: GROUPON_ACTIVITY.id, // 冗余活动 id
      userId: user.id, // 成员
      orderId: grouponOrder.id, // 成员订单
    },
    update: {
      activityId: GROUPON_ACTIVITY.id, // 冗余活动 id
      orderId: grouponOrder.id, // 成员订单
    },
  });

  // 使用固定 id 播种的表：显式写入 id 不会推进自增序列，需在种子末尾手动对齐
  const explicitIdTables = [
    "courses", // 课程（固定 id 1、2）
    "groupon_activities", // 拼团活动（固定 id 1）
    "flash_sale_activities", // 秒杀活动（固定 id 1）
    "coupon_templates", // 券模板（固定 id 1）
    "groupon_groups", // 团组（固定 id 1）
  ];
  for (const table of explicitIdTables) {
    // 表名来自内置常量列表，不存在外部输入
    const sequenceSql = `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM "${table}"), 1), 1))`;
    // 序列对齐到当前最大 id，业务侧下一次 create 从 max+1 开始，避免主键冲突
    await prisma.$executeRawUnsafe(sequenceSql);
  }

  // 输出账号提示（管理员 TOTP 密钥已在生成时打印 otpauth URI）
  console.log(`演示数据种子完成：${admin.email}（密码见项目说明文档）`);
  console.log(`演示数据种子完成：${user.email}（密码见项目说明文档）`);
}

// 独立执行种子：不传 client 时自建并关闭（供集成测试直接调用）
export async function execSeed(prisma?: PrismaClient): Promise<void> {
  // 是否由本函数持有 PrismaClient（决定是否需要断开连接）
  const ownsClient = prisma === undefined;
  // 实际使用的 PrismaClient 实例
  const client = prisma ?? new PrismaClient();
  try {
    await seedDemoData(client);
  } finally {
    if (ownsClient) await client.$disconnect();
  }
}

// CLI 入口：读取配置并执行种子
async function main(): Promise<void> {
  // 加载应用配置（需要 DATABASE_URL 等环境变量）
  const cfg = loadConfig();
  if (!cfg.seedDemoData && process.env.NODE_ENV === "production") {
    console.log("prod 环境不注入演示数据，跳过");
    return;
  }
  // 独立进程使用的 PrismaClient
  const prisma = new PrismaClient();
  try {
    await seedDemoData(prisma, cfg.bcryptCost);
  } finally {
    await prisma.$disconnect();
  }
}

// 直接运行本文件时才执行 CLI 入口（被测试 import 时不执行）
if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
