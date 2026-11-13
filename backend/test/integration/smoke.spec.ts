import { PrismaClient } from '@prisma/client';
import { execSeed } from '../../prisma/seed';
import {
  COUPON_TEMPLATE,
  COURSE_TYPESCRIPT,
  DEMO_ADMIN,
  DEMO_GROUPON_USER,
  DEMO_USER,
  FLASH_SALE_ACTIVITY,
  GROUPON_ACTIVITY,
  GROUPON_GROUP_ONE_SHORT,
} from '../../prisma/seed-data';

describe('迁移与种子冒烟（CI）', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('全部核心表可查询', async () => {
    await expect(prisma.user.count()).resolves.toBeGreaterThanOrEqual(2);
    for (const model of ['course', 'order', 'couponTemplate', 'couponClaim', 'grouponActivity',
      'grouponGroup', 'grouponMember', 'flashSaleActivity', 'question', 'exam', 'post',
      'blockedWord', 'favorite', 'learningRecord', 'auditLog', 'idempotencyKey']) {
      await expect((prisma as any)[model].count()).resolves.toBeDefined();
    }
  });

  it('演示账号就位（admin/user/groupon，均 active）', async () => {
    const admin = await prisma.user.findUnique({ where: { email: DEMO_ADMIN.email } });
    expect(admin?.role).toBe('admin');
    expect(admin?.status).toBe('active');
    const user = await prisma.user.findUnique({ where: { email: DEMO_USER.email } });
    expect(user?.role).toBe('user');
    const grouponUser = await prisma.user.findUnique({
      where: { email: DEMO_GROUPON_USER.email },
    });
    expect(grouponUser?.role).toBe('user');
    expect(grouponUser?.status).toBe('active');
  });

  it('学员账号持普通已支付订单（可学习）', async () => {
    const user = await prisma.user.findUnique({ where: { email: DEMO_USER.email } });
    const order = await prisma.order.findFirst({
      where: { userId: user!.id, courseId: COURSE_TYPESCRIPT.id },
    });
    expect(order?.status).toBe('paid');
    expect(order?.activityType).toBe('normal');
  });

  it('course-typescript 为已发布视频课且含 2 个章节', async () => {
    const c = await prisma.course.findUnique({ where: { id: COURSE_TYPESCRIPT.id } });
    expect(c?.status).toBe('published');
    expect(c?.type).toBe('video');
    expect(await prisma.chapter.count({ where: { courseId: c!.id } })).toBe(2);
  });

  it('进行中双人拼团活动 + 仅差一人团组（含待成团订单）', async () => {
    const act = await prisma.grouponActivity.findUnique({ where: { id: GROUPON_ACTIVITY.id } });
    expect(act?.status).toBe('ongoing');
    expect(act?.targetSize).toBe(2);
    const g = await prisma.grouponGroup.findUnique({ where: { id: GROUPON_GROUP_ONE_SHORT.id } });
    expect(g?.status).toBe('pending');
    expect(g?.memberCount).toBe(1);
    expect(await prisma.grouponMember.count({ where: { groupId: g!.id } })).toBe(1);
    const member = await prisma.grouponMember.findFirst({ where: { groupId: g!.id } });
    const grouponUser = await prisma.user.findUnique({
      where: { email: DEMO_GROUPON_USER.email },
    });
    // 拼团演示使用独立账号，避免占用学员账号的课程购买位
    expect(member?.userId).toBe(grouponUser!.id);
    const order = await prisma.order.findUnique({ where: { id: member!.orderId } });
    expect(order?.status).toBe('paid');
    expect(order?.activityType).toBe('groupon');
    expect(order?.userId).toBe(grouponUser!.id);
  });

  it('未开始秒杀活动（库存 > 已售）', async () => {
    const act = await prisma.flashSaleActivity.findUnique({ where: { id: FLASH_SALE_ACTIVITY.id } });
    expect(act?.status).toBe('not_started');
    expect(act!.stock).toBeGreaterThan(act!.sold);
  });

  it('新学员立减券模板（已启用，面额 2000 分）', async () => {
    const t = await prisma.couponTemplate.findUnique({ where: { id: COUPON_TEMPLATE.id } });
    expect(t?.status).toBe('enabled');
    expect(t?.discountCents).toBe(2000);
  });

  it('种子可重复执行且不产生重复数据', async () => {
    await execSeed();
    expect(await prisma.user.count({ where: { email: DEMO_ADMIN.email } })).toBe(1);
    expect(await prisma.user.count({ where: { email: DEMO_GROUPON_USER.email } })).toBe(1);
    expect(await prisma.chapter.count({ where: { courseId: COURSE_TYPESCRIPT.id } })).toBe(2);
  });
});
