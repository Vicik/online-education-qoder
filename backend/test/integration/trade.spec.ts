import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import { COURSE_TYPESCRIPT, DEMO_ADMIN } from '../../prisma/seed-data';

// 本次运行唯一后缀：隔离账号与幂等键，避免重复执行冲突
const SUFFIX = Date.now();
// 测试账号统一密码（满足 8–64 位策略）
const PASSWORD = 'Passw0rd1';
// 一天毫秒数
const DAY_MS = 24 * 60 * 60 * 1000;

describe('订单与支付（CI 集成，基于种子）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  // 本用例自建的券模板 id（不依赖步骤 06 用例的启停状态）
  let couponTemplateId: number;
  // 主流程创建的订单 id
  let mainOrderId: number;
  // 主流程学员邮箱
  const mainEmail = `trade-main-${SUFFIX}@test.com`;
  // 主流程学员会话
  let mainAgent: ReturnType<typeof request.agent>;

  // 启动应用（与 main.ts 保持一致的中间件与管道）
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    const config = loadConfig();
    const redis = app.get(RedisService);
    // 路由注册前挂载会话中间件
    app.use(sessionMiddleware(config, () => redis.getClient()));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = new PrismaClient();
    // 自建独立券模板与适用课程，避免与优惠券用例互相影响
    const template = await prisma.couponTemplate.create({
      data: {
        name: `交易测试券-${SUFFIX}`,
        discountCents: 2000,
        startAt: new Date(Date.now() - DAY_MS),
        endAt: new Date(Date.now() + DAY_MS),
        totalQty: 100,
        perUserLimit: 1,
        status: 'enabled',
        courses: { create: { courseId: COURSE_TYPESCRIPT.id } },
      },
    });
    couponTemplateId = template.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // 注册并登录一个新学员，返回保持会话的 agent
  const registerAndLogin = async (email: string) => {
    // 注册
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, confirmPassword: PASSWORD, nickname: '交易测试' })
      .expect(201);
    // 登录
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return agent;
  };

  // 管理员登录，返回保持会话的 agent
  const loginAdmin = async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: DEMO_ADMIN.email, password: DEMO_ADMIN.password })
      .expect(200);
    return agent;
  };

  it('预览计价与下单全链路：领券 → 预览 → 下单 → 支付 → 学习权限生效', async () => {
    mainAgent = await registerAndLogin(mainEmail);

    // 领取自建券
    const claim = await mainAgent
      .post(`/api/v1/coupons/${couponTemplateId}/claim`)
      .set('Idempotency-Key', `itg-trade-claim-${SUFFIX}`)
      .expect(201);
    const claimId = claim.body.data.id as number;

    // 服务端计价：99 元 − 20 元券 = 79 元
    const preview = await mainAgent
      .get(`/api/v1/checkout/${COURSE_TYPESCRIPT.id}/preview?couponId=${claimId}`)
      .expect(200);
    expect(preview.body.data).toMatchObject({
      courseId: COURSE_TYPESCRIPT.id,
      activityType: 'normal',
      activityId: null,
      originalCents: 19900,
      currentCents: 9900,
      discountCents: 2000,
      paidCents: 7900,
      couponClaimId: claimId,
    });

    // 下单（幂等键）
    const created = await mainAgent
      .post('/api/v1/orders')
      .set('Idempotency-Key', `itg-trade-order-${SUFFIX}`)
      .send({ courseId: COURSE_TYPESCRIPT.id, couponClaimId: claimId })
      .expect(201);
    expect(created.body.data).toMatchObject({
      status: 'pending',
      courseName: COURSE_TYPESCRIPT.name,
      originalCents: 19900,
      currentCents: 9900,
      discountCents: 2000,
      paidCents: 7900,
      couponClaimId: claimId,
    });
    mainOrderId = created.body.data.id as number;

    // 券已核销
    const usedClaim = await prisma.couponClaim.findUnique({
      where: { id: claimId },
    });
    expect(usedClaim?.status).toBe('used');
    expect(usedClaim?.usedAt).not.toBeNull();

    // 模拟支付
    const paid = await mainAgent
      .post(`/api/v1/orders/${mainOrderId}/pay`)
      .expect(200);
    expect(paid.body.data.status).toBe('paid');
    expect(paid.body.data.paidAt).not.toBeNull();

    // 支付台账：channel=mock、流水号、实付金额
    const payment = await prisma.payment.findUnique({
      where: { orderId: mainOrderId },
    });
    expect(payment).toMatchObject({
      channel: 'mock',
      amountCents: 7900,
      status: 'success',
    });
    expect(payment!.transactionNo).toMatch(/^MOCK-/);

    // 学习权限以 order.paid 为准：章节正文可访问
    const chapter = await prisma.chapter.findFirst({
      where: { courseId: COURSE_TYPESCRIPT.id },
      orderBy: { sortOrder: 'asc' },
    });
    await mainAgent
      .get(
        `/api/v1/courses/${COURSE_TYPESCRIPT.id}/chapters/${chapter!.id}/content`,
      )
      .expect(200);

    // 再次支付幂等返回已支付订单
    const paidAgain = await mainAgent
      .post(`/api/v1/orders/${mainOrderId}/pay`)
      .expect(200);
    expect(paidAgain.body.data.status).toBe('paid');
    expect(paidAgain.body.data.id).toBe(mainOrderId);

    // 重复购买被拒（purchaseKey 唯一）
    const duplicate = await mainAgent
      .post('/api/v1/orders')
      .set('Idempotency-Key', `itg-trade-dup-${SUFFIX}`)
      .send({ courseId: COURSE_TYPESCRIPT.id })
      .expect(409);
    expect(duplicate.body.code).toBe(4003);
  });

  it('同幂等键重复下单返回首次订单', async () => {
    const agent = await registerAndLogin(`trade-replay-${SUFFIX}@test.com`);
    // 同一幂等键连续两次下单
    const key = `itg-trade-replay-${SUFFIX}`;
    const first = await agent
      .post('/api/v1/orders')
      .set('Idempotency-Key', key)
      .send({ courseId: COURSE_TYPESCRIPT.id })
      .expect(201);
    const second = await agent
      .post('/api/v1/orders')
      .set('Idempotency-Key', key)
      .send({ courseId: COURSE_TYPESCRIPT.id })
      .expect(201);

    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('他人订单不可见（IDOR 防护）', async () => {
    const other = await registerAndLogin(`trade-other-${SUFFIX}@test.com`);

    const detail = await other.get(`/api/v1/orders/${mainOrderId}`).expect(403);
    expect(detail.body.code).toBe(2002);

    const pay = await other
      .post(`/api/v1/orders/${mainOrderId}/pay`)
      .expect(403);
    expect(pay.body.code).toBe(2002);
  });

  it('订单列表仅本人；管理端可见全部并带用户信息', async () => {
    // 本人列表只含自己的订单
    const mine = await mainAgent.get('/api/v1/user/orders').expect(200);
    expect(mine.body.data.total).toBe(1);
    expect(mine.body.data.items[0]).toMatchObject({
      id: mainOrderId,
      courseName: COURSE_TYPESCRIPT.name,
      status: 'paid',
    });

    // 管理端可见全部订单，含下单用户信息
    const admin = await loginAdmin();
    const all = await admin
      .get('/api/v1/admin/orders?page=1&pageSize=100')
      .expect(200);
    const target = (all.body.data.items as Array<{ id: number; user?: { email: string } }>)
      .find((item) => item.id === mainOrderId);
    expect(target).toBeDefined();
    expect(target!.user?.email).toBe(mainEmail);
  });

  it('实付 0 元订单仍可支付（确认报名）', async () => {
    // 自建 0 价已发布课程
    const freeCourse = await prisma.course.create({
      data: {
        name: `0元课-${SUFFIX}`,
        type: 'rich',
        originalCents: 0,
        saleCents: 0,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'published',
      },
    });
    const agent = await registerAndLogin(`trade-free-${SUFFIX}@test.com`);

    // 实付 0 元下单
    const created = await agent
      .post('/api/v1/orders')
      .set('Idempotency-Key', `itg-trade-free-${SUFFIX}`)
      .send({ courseId: freeCourse.id })
      .expect(201);
    expect(created.body.data.paidCents).toBe(0);

    // 0 元仍生成支付台账并置为已支付
    const paid = await agent
      .post(`/api/v1/orders/${created.body.data.id}/pay`)
      .expect(200);
    expect(paid.body.data.status).toBe('paid');
    const payment = await prisma.payment.findUnique({
      where: { orderId: created.body.data.id },
    });
    expect(payment).toMatchObject({ amountCents: 0, channel: 'mock' });
  });

  it('预览与下单的边界校验', async () => {
    // 未登录预览 401
    await request(app.getHttpServer())
      .get(`/api/v1/checkout/${COURSE_TYPESCRIPT.id}/preview`)
      .expect(401);

    const agent = await registerAndLogin(`trade-guard-${SUFFIX}@test.com`);

    // 缺少幂等键 400（code=1001）
    const noKey = await agent
      .post('/api/v1/orders')
      .send({ courseId: COURSE_TYPESCRIPT.id })
      .expect(400);
    expect(noKey.body.code).toBe(1001);

    // 草稿课程不可购买 422
    await agent.get('/api/v1/checkout/2/preview').expect(422);

    // 不存在课程 404
    await agent.get('/api/v1/checkout/999999/preview').expect(404);

    // 不可用券 422（code=4002）
    const invalidCoupon = await agent
      .get(`/api/v1/checkout/${COURSE_TYPESCRIPT.id}/preview?couponId=999999`)
      .expect(422);
    expect(invalidCoupon.body.code).toBe(4002);
  });
});
