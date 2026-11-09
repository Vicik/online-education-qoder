import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { FlashStockService } from '../../src/promotion/flash-sale/flash-stock.service';
import { RedisService } from '../../src/redis/redis.service';

jest.setTimeout(120000);

const SUFFIX = Date.now();
const PASSWORD = 'Passw0rd1';
const HOUR_MS = 60 * 60 * 1000;
const USER_COUNT = 50;

type Agent = ReturnType<typeof request.agent>;
type AttemptResult = { status: number; code?: number };

describe('秒杀防超卖（CI 并发）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stockService: FlashStockService;
  let agents: Agent[];
  // 同一用户并发下单专用会话
  let soloAgent: Agent;
  // 50 人抢购的活动
  let raceActivityId: number;
  // 同一用户并发下单的活动
  let soloActivityId: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    const config = loadConfig();
    const redis = app.get(RedisService);
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
    stockService = app.get(FlashStockService);

    // 两个活动各用一门新建课程：同课程活动时间不得重叠
    const createCourse = (label: string) =>
      prisma.course.create({
        data: {
          name: `${label}-${SUFFIX}`,
          type: 'rich',
          originalCents: 9900,
          saleCents: 9900,
          status: 'published',
        },
      });
    const raceCourse = await createCourse('秒杀并发课程');
    const soloCourse = await createCourse('秒杀同人课程');

    // 库存 10 的活动：50 人并发抢购
    const raceActivity = await prisma.flashSaleActivity.create({
      data: {
        courseId: raceCourse.id,
        name: `并发秒杀-${SUFFIX}`,
        priceCents: 100,
        stock: 10,
        startAt: new Date(Date.now() - HOUR_MS),
        endAt: new Date(Date.now() + HOUR_MS),
        status: 'ongoing',
      },
    });
    raceActivityId = raceActivity.id;
    await stockService.warmup(raceActivityId, 10);

    // 库存 2 的活动：同一用户并发下单
    const soloActivity = await prisma.flashSaleActivity.create({
      data: {
        courseId: soloCourse.id,
        name: `同人并发-${SUFFIX}`,
        priceCents: 100,
        stock: 2,
        startAt: new Date(Date.now() - HOUR_MS),
        endAt: new Date(Date.now() + HOUR_MS),
        status: 'ongoing',
      },
    });
    soloActivityId = soloActivity.id;
    await stockService.warmup(soloActivityId, 2);

    // 直接建号并登录，避免注册接口按 IP 限流；密码哈希只算一次
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const createAgent = async (index: number): Promise<Agent> => {
      const email = `flash-race-${SUFFIX}-${index}@test.com`;
      await prisma.user.create({
        data: { email, nickname: `秒杀并发${index}`, passwordHash },
      });
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      return agent;
    };

    agents = [];
    for (let index = 0; index < USER_COUNT; index += 1) {
      agents.push(await createAgent(index));
    }
    soloAgent = await createAgent(USER_COUNT);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // 下单请求归一化：失败时只保留 HTTP 状态与业务码
  const purchase = async (
    agent: Agent,
    activityId: number,
    key: string,
  ): Promise<AttemptResult> => {
    const res = await agent
      .post(`/api/v1/flash-sales/${activityId}/purchase`)
      .set('Idempotency-Key', key);
    return { status: res.status, code: (res.body as { code?: number }).code };
  };

  it('库存 10 并发 50 人抢购：恰好 10 单成功，无超卖', async () => {
    const results = await Promise.all(
      agents.map((agent, index) =>
        purchase(agent, raceActivityId, `itg-flash-race-${SUFFIX}-${index}`),
      ),
    );

    // 恰好 10 单成功
    expect(results.filter((item) => item.status === 201)).toHaveLength(10);
    // 其余 40 人收到 4001 已售罄
    expect(results.filter((item) => item.code === 4001)).toHaveLength(40);

    // 下单不支付时 DB sold 不增长，且永不超过库存
    const activity = await prisma.flashSaleActivity.findUnique({
      where: { id: raceActivityId },
    });
    expect(activity!.sold).toBeLessThanOrEqual(10);
    expect(activity!.sold).toBe(0);

    // Redis 预占归零
    await expect(stockService.remaining(raceActivityId)).resolves.toBe(0);

    // 落库订单恰好 10 笔
    await expect(
      prisma.order.count({
        where: { activityType: 'flash_sale', activityId: raceActivityId },
      }),
    ).resolves.toBe(10);
  });

  it('同一用户并发两次下单只成功一次', async () => {
    const results = await Promise.all([
      purchase(soloAgent, soloActivityId, `itg-flash-solo-a-${SUFFIX}`),
      purchase(soloAgent, soloActivityId, `itg-flash-solo-b-${SUFFIX}`),
    ]);

    // 一成一败，失败方为限购冲突
    expect(results.filter((item) => item.status === 201)).toHaveLength(1);
    const rejected = results.find((item) => item.status !== 201);
    expect(rejected?.status).toBe(409);
    expect(rejected?.code).toBe(5003);

    // 失败方的预占已回补，仅消耗 1 件
    await expect(stockService.remaining(soloActivityId)).resolves.toBe(1);
    await expect(
      prisma.order.count({
        where: { activityType: 'flash_sale', activityId: soloActivityId },
      }),
    ).resolves.toBe(1);
  });
});
