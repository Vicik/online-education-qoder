import { INestApplication } from '@nestjs/common';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { ExamUserService } from '../../src/exam/exam/exam.user.service';
import { FlashStockService } from '../../src/promotion/flash-sale/flash-stock.service';
import { GrouponUserService } from '../../src/promotion/groupon/groupon.user.service';
import { RedisService } from '../../src/redis/redis.service';
import { OrderService } from '../../src/trade/order/order.service';

jest.setTimeout(60000);

const SUFFIX = Date.now();
const HOUR_MS = 60 * 60 * 1000;
const PASSWORD = 'Passw0rd1';

describe('Worker 任务（CI 集成）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let grouponService: GrouponUserService;
  let orderService: OrderService;
  let examService: ExamUserService;
  let stockService: FlashStockService;
  let userId: number;
  let courseId: number;
  let couponTemplateId: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    const config = loadConfig();
    const redis = app.get(RedisService);
    app.use(sessionMiddleware(config, () => redis.getClient()));
    app.useGlobalPipes(
      new TrimmingValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = new PrismaClient();
    grouponService = app.get(GrouponUserService);
    orderService = app.get(OrderService);
    examService = app.get(ExamUserService);
    stockService = app.get(FlashStockService);

    const user = await prisma.user.create({
      data: {
        email: `jobs-${SUFFIX}@test.com`,
        nickname: '定时任务测试',
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      },
    });
    userId = user.id;

    const course = await prisma.course.create({
      data: {
        name: `定时任务课程-${SUFFIX}`,
        type: 'audio',
        originalCents: 19900,
        saleCents: 9900,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'published',
      },
    });
    courseId = course.id;

    const template = await prisma.couponTemplate.create({
      data: {
        name: `定时任务券-${SUFFIX}`,
        discountCents: 2000,
        startAt: new Date(Date.now() - HOUR_MS),
        endAt: new Date(Date.now() + 24 * HOUR_MS),
        totalQty: 10,
        status: 'enabled',
      },
    });
    couponTemplateId = template.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('拼团到期：pending 团过期 → failed + 订单 refunded + 券 restored + 退款台账', async () => {
    const activity = await prisma.grouponActivity.create({
      data: {
        courseId,
        name: `到期拼团-${SUFFIX}`,
        priceCents: 6900,
        targetSize: 2,
        startAt: new Date(Date.now() - 2 * HOUR_MS),
        endAt: new Date(Date.now() - HOUR_MS),
        status: 'ongoing',
      },
    });
    const group = await prisma.grouponGroup.create({
      data: {
        activityId: activity.id,
        status: 'pending',
        memberCount: 0,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const claim = await prisma.couponClaim.create({
      data: {
        templateId: couponTemplateId,
        userId,
        status: 'used',
        usedAt: new Date(),
      },
    });
    const order = await prisma.order.create({
      data: {
        orderNo: `ZX-JOBS-GRP-${SUFFIX}`,
        userId,
        courseId,
        activityType: 'groupon',
        activityId: group.id,
        originalCents: 19900,
        currentCents: 6900,
        discountCents: 2000,
        paidCents: 4900,
        couponClaimId: claim.id,
        status: 'paid',
        paidAt: new Date(),
        purchaseKey: `user:${userId}:course:${courseId}:grp:${SUFFIX}`,
      },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        channel: 'mock',
        transactionNo: `MOCK-JOBS-GRP-${SUFFIX}`,
        amountCents: 4900,
        status: 'success',
      },
    });
    await prisma.grouponMember.create({
      data: {
        groupId: group.id,
        activityId: activity.id,
        userId,
        orderId: order.id,
      },
    });

    const n = await grouponService.failExpiredGroups(new Date());
    expect(n).toBeGreaterThanOrEqual(1);

    const failedGroup = await prisma.grouponGroup.findUnique({
      where: { id: group.id },
    });
    expect(failedGroup!.status).toBe('failed');

    const refundedOrder = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(refundedOrder!.status).toBe('refunded');
    expect(refundedOrder!.purchaseKey).toBeNull();

    const refund = await prisma.payment.findUnique({
      where: { orderId: order.id },
    });
    expect(refund!.status).toBe('refunded');

    const restoredClaim = await prisma.couponClaim.findUnique({
      where: { id: claim.id },
    });
    expect(restoredClaim!.status).toBe('restored');
  });

  it('订单超时取消：pending 过期 → cancelled + 券 restored + 秒杀预占回补', async () => {
    const activity = await prisma.flashSaleActivity.create({
      data: {
        courseId,
        name: `超时秒杀-${SUFFIX}`,
        priceCents: 100,
        stock: 5,
        sold: 0,
        startAt: new Date(Date.now() - HOUR_MS),
        endAt: new Date(Date.now() + HOUR_MS),
        status: 'ongoing',
      },
    });
    // 模拟下单时预占一件：Redis 剩余 = 5 - 1
    await stockService.warmup(activity.id, 4);

    const claim = await prisma.couponClaim.create({
      data: {
        templateId: couponTemplateId,
        userId,
        status: 'used',
        usedAt: new Date(),
      },
    });
    const order = await prisma.order.create({
      data: {
        orderNo: `ZX-JOBS-FLS-${SUFFIX}`,
        userId,
        courseId,
        activityType: 'flash_sale',
        activityId: activity.id,
        originalCents: 19900,
        currentCents: 100,
        discountCents: 2000,
        paidCents: 0,
        couponClaimId: claim.id,
        status: 'pending',
        expiresAt: new Date(Date.now() - 1000),
        purchaseKey: `user:${userId}:course:${courseId}:fls:${SUFFIX}`,
        flashPurchaseKey: `user:${userId}:flash:${activity.id}:${SUFFIX}`,
      },
    });

    const n = await orderService.cancelExpiredOrders(new Date());
    expect(n).toBeGreaterThanOrEqual(1);

    const cancelled = await prisma.order.findUnique({
      where: { id: order.id },
    });
    expect(cancelled!.status).toBe('cancelled');
    expect(cancelled!.purchaseKey).toBeNull();
    expect(cancelled!.flashPurchaseKey).toBeNull();

    const restoredClaim = await prisma.couponClaim.findUnique({
      where: { id: claim.id },
    });
    expect(restoredClaim!.status).toBe('restored');

    // 预占回补后剩余库存恢复为 5
    await expect(stockService.remaining(activity.id)).resolves.toBe(5);
  });

  it('考试兜底交卷：deadline 已过未提交 → 自动判分（空答案 0 分）', async () => {
    const exam = await prisma.exam.create({
      data: {
        title: `定时任务考试-${SUFFIX}`,
        description: 'Worker 兜底交卷',
        durationMin: 10,
        passScore: 1,
        totalScore: 5,
        status: 'published',
        publishedAt: new Date(),
        snapshot: [
          {
            questionId: 1,
            type: 'single',
            stem: '1+1=?',
            options: [
              { key: 'A', text: '2' },
              { key: 'B', text: '3' },
            ],
            score: 5,
            sortOrder: 1,
            answer: ['A'],
            analysis: '显然',
          },
        ],
      },
    });
    const attempt = await prisma.examAttempt.create({
      data: {
        examId: exam.id,
        userId,
        deadlineAt: new Date(Date.now() - 1000),
        answers: {},
      },
    });

    const n = await examService.autoSubmitExpired(new Date());
    expect(n).toBeGreaterThanOrEqual(1);

    const submitted = await prisma.examAttempt.findUnique({
      where: { id: attempt.id },
    });
    expect(submitted!.submittedAt).not.toBeNull();
    expect(submitted!.score).toBe(0);
  });
});
