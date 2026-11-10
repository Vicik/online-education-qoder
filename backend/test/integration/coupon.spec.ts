import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import {
  COUPON_TEMPLATE,
  COURSE_TYPESCRIPT,
  DEMO_ADMIN,
  DEMO_USER,
} from '../../prisma/seed-data';

describe('优惠券（CI 集成，基于种子）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let demoUserId: number;
  let firstClaimId: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    const config = loadConfig();
    const redis = app.get(RedisService);
    // 与 main.ts 一致：路由注册前挂载会话中间件
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
    const demoUser = await prisma.user.findUnique({
      where: { email: DEMO_USER.email },
    });
    demoUserId = demoUser!.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // 学员登录，返回保持会话的 agent
  const loginUser = async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email: DEMO_USER.email, password: DEMO_USER.password })
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

  it('课程详情可领券含种子立减券', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}/coupons`)
      .expect(200);
    expect(res.body.data.map((template: { name: string }) => template.name))
      .toContain(COUPON_TEMPLATE.name);
  });

  it('领取 → 再领被拒（限领一张）', async () => {
    const agent = await loginUser();

    const first = await agent
      .post(`/api/v1/coupons/${COUPON_TEMPLATE.id}/claim`)
      .set('Idempotency-Key', 'itg-coupon-0001')
      .expect(201);
    expect(first.body.data.status).toBe('unused');
    firstClaimId = first.body.data.id;

    const again = await agent
      .post(`/api/v1/coupons/${COUPON_TEMPLATE.id}/claim`)
      .set('Idempotency-Key', 'itg-coupon-0002')
      .expect(409);
    expect(again.body.message).toContain('限领');
  });

  it('同幂等键重放返回首次结果（不产生第二条记录）', async () => {
    const agent = await loginUser();

    const replay = await agent
      .post(`/api/v1/coupons/${COUPON_TEMPLATE.id}/claim`)
      .set('Idempotency-Key', 'itg-coupon-0001')
      .expect(201);
    expect(replay.body.data.id).toBe(firstClaimId);
    expect(replay.body.data.status).toBe('unused');

    // 同一启用周期内仅一条未失效记录
    const activeCount = await prisma.couponClaim.count({
      where: {
        templateId: COUPON_TEMPLATE.id,
        userId: demoUserId,
        claimKey: { not: null },
      },
    });
    expect(activeCount).toBe(1);
  });

  it('停用级联后记录 invalid 且可重新领取', async () => {
    const admin = await loginAdmin();
    const agent = await loginUser();

    // 依赖上一条用例产生的领取记录
    const claim = await prisma.couponClaim.findUnique({
      where: { id: firstClaimId },
    });
    expect(claim?.status).toBe('unused');

    // 停用：携带当前版本号做乐观锁
    const template = await prisma.couponTemplate.findUnique({
      where: { id: COUPON_TEMPLATE.id },
    });
    await admin
      .post(`/api/v1/admin/coupons/${COUPON_TEMPLATE.id}/disable`)
      .send({ version: template!.version })
      .expect(200);

    // 级联：未使用记录永久失效且 claimKey 置 NULL
    const invalidated = await prisma.couponClaim.findUnique({
      where: { id: firstClaimId },
    });
    expect(invalidated?.status).toBe('invalid');
    expect(invalidated?.claimKey).toBeNull();

    // claimedCount 只计未失效记录
    const afterDisable = await prisma.couponTemplate.findUnique({
      where: { id: COUPON_TEMPLATE.id },
    });
    const activeCount = await prisma.couponClaim.count({
      where: { templateId: COUPON_TEMPLATE.id, status: { not: 'invalid' } },
    });
    expect(afterDisable?.claimedCount).toBe(activeCount);

    // 停用期间不可领取
    await agent
      .post(`/api/v1/coupons/${COUPON_TEMPLATE.id}/claim`)
      .set('Idempotency-Key', 'itg-coupon-0003')
      .expect(422);

    // 重新启用不恢复 invalid，但允许重新领取
    await admin
      .post(`/api/v1/admin/coupons/${COUPON_TEMPLATE.id}/enable`)
      .expect(200);
    const reclaim = await agent
      .post(`/api/v1/coupons/${COUPON_TEMPLATE.id}/claim`)
      .set('Idempotency-Key', 'itg-coupon-0004')
      .expect(201);
    expect(reclaim.body.data.status).toBe('unused');
  });
});
