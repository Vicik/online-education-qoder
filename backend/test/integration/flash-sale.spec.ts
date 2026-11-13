import { INestApplication } from '@nestjs/common';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { FlashStockService } from '../../src/promotion/flash-sale/flash-stock.service';
import { RedisService } from '../../src/redis/redis.service';
import {
  COURSE_TYPESCRIPT,
  DEMO_ADMIN,
  FLASH_SALE_ACTIVITY,
} from '../../prisma/seed-data';

// 本次运行唯一后缀：隔离账号与幂等键，避免重复执行冲突
const SUFFIX = Date.now();
// 测试账号统一密码（满足 8–64 位策略）
const PASSWORD = 'Passw0rd1';
// 一小时毫秒数
const HOUR_MS = 60 * 60 * 1000;

jest.setTimeout(60000);

describe('秒杀（CI 集成，基于种子）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stockService: FlashStockService;
  // 管理员会话
  let admin: ReturnType<typeof request.agent>;
  // 购买用户会话
  let buyer: ReturnType<typeof request.agent>;
  // 管理端创建的活动 id
  let activityId: number;
  // 秒杀专用课程 id（避免与种子拼团活动时间冲突）
  let flashCourseId: number;
  // 购买生成的订单 id
  let orderId: number;

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
      new TrimmingValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = new PrismaClient();
    stockService = app.get(FlashStockService);
    // 清理种子活动的 Redis 库存键，确保剩余库存从数据库回源
    await redis.del(`flash:stock:${FLASH_SALE_ACTIVITY.id}`);

    // 新建已发布课程：秒杀活动不与种子拼团活动共享课程，规避时间互斥
    const flashCourse = await prisma.course.create({
      data: {
        name: `秒杀课程-${SUFFIX}`,
        type: 'audio',
        originalCents: 9900,
        saleCents: 9900,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'published',
      },
    });
    flashCourseId = flashCourse.id;

    // 管理员登录
    admin = request.agent(app.getHttpServer());
    await admin
      .post('/api/v1/auth/login')
      .send({ email: DEMO_ADMIN.email, password: DEMO_ADMIN.password })
      .expect(200);

    // 购买用户：直接建号并登录，避免注册接口按 IP 限流
    const buyerEmail = `flash-buyer-${SUFFIX}@test.com`;
    await prisma.user.create({
      data: {
        email: buyerEmail,
        nickname: '秒杀测试',
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      },
    });
    buyer = request.agent(app.getHttpServer());
    await buyer
      .post('/api/v1/auth/login')
      .send({ email: buyerEmail, password: PASSWORD })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('活动列表仅含进行中活动；详情带总库存与剩余库存', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/flash-sales?page=1&pageSize=100')
      .expect(200);
    const items = list.body.data.items as Array<{ id: number; status: string }>;
    // 未开始的种子秒杀不进入列表
    expect(items.some((item) => item.id === FLASH_SALE_ACTIVITY.id)).toBe(
      false,
    );
    // 列表只返回进行中的活动
    expect(items.every((item) => item.status === 'ongoing')).toBe(true);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/flash-sales/${FLASH_SALE_ACTIVITY.id}`)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      id: FLASH_SALE_ACTIVITY.id,
      stock: FLASH_SALE_ACTIVITY.stock,
      sold: FLASH_SALE_ACTIVITY.sold,
      remaining: FLASH_SALE_ACTIVITY.stock - FLASH_SALE_ACTIVITY.sold,
      status: 'not_started',
    });
  });

  it('未开始活动下单被拒（5002）', async () => {
    const res = await buyer
      .post(`/api/v1/flash-sales/${FLASH_SALE_ACTIVITY.id}/purchase`)
      .set('Idempotency-Key', `itg-flash-notstarted-${SUFFIX}`)
      .expect(422);
    expect(res.body.code).toBe(5002);
  });

  it('同课程已有拼团活动时创建秒杀被拒（跨类型 422）', async () => {
    const res = await admin
      .post('/api/v1/admin/flash-sales')
      .send({
        courseId: COURSE_TYPESCRIPT.id,
        name: `冲突秒杀-${SUFFIX}`,
        priceCents: 100,
        stock: 3,
        startAt: new Date(Date.now() - HOUR_MS).toISOString(),
        endAt: new Date(Date.now() + HOUR_MS).toISOString(),
      })
      .expect(422);
    expect(res.body.code).toBe(1001);
  });

  it('管理端创建活动 → 预热 → 购买 → 支付 → 库存 sold+1', async () => {
    const created = await admin
      .post('/api/v1/admin/flash-sales')
      .send({
        courseId: flashCourseId,
        name: `限时秒杀-${SUFFIX}`,
        priceCents: 100,
        stock: 3,
        startAt: new Date(Date.now() - HOUR_MS).toISOString(),
        endAt: new Date(Date.now() + HOUR_MS).toISOString(),
      })
      .expect(201);
    activityId = created.body.data.id as number;
    expect(created.body.data).toMatchObject({
      status: 'not_started',
      stock: 3,
      sold: 0,
      remaining: 3,
    });

    // 状态流转（not_started→ongoing）与库存预热由 Worker（步骤 12）执行；
    // 本用例直接改库置 ongoing + warmup，模拟 Worker 行为
    await prisma.flashSaleActivity.update({
      where: { id: activityId },
      data: { status: 'ongoing' },
    });
    await stockService.warmup(activityId, 3);

    const order = await buyer
      .post(`/api/v1/flash-sales/${activityId}/purchase`)
      .set('Idempotency-Key', `itg-flash-p1-${SUFFIX}`)
      .expect(201);
    orderId = order.body.data.order.id as number;

    await buyer.post(`/api/v1/orders/${orderId}/pay`).expect(200);

    const act = await prisma.flashSaleActivity.findUnique({
      where: { id: activityId },
    });
    expect(act!.sold).toBe(1);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/flash-sales/${activityId}`)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      stock: 3,
      sold: 1,
      remaining: 2,
      status: 'ongoing',
    });
  });

  it('重复购买同一活动被拒（5003）且库存回补', async () => {
    const res = await buyer
      .post(`/api/v1/flash-sales/${activityId}/purchase`)
      .set('Idempotency-Key', `itg-flash-dup-${SUFFIX}`)
      .expect(409);
    expect(res.body.code).toBe(5003);

    const act = await prisma.flashSaleActivity.findUnique({
      where: { id: activityId },
    });
    expect(act!.sold).toBe(1);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/flash-sales/${activityId}`)
      .expect(200);
    expect(detail.body.data.remaining).toBe(2);
  });
});
