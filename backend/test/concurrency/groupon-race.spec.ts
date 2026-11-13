import { INestApplication } from '@nestjs/common';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import { COURSE_TYPESCRIPT } from '../../prisma/seed-data';

jest.setTimeout(60000);

const SUFFIX = Date.now();
const PASSWORD = 'Passw0rd1';
const HOUR_MS = 60 * 60 * 1000;
const USER_COUNT = 11;

type Agent = ReturnType<typeof request.agent>;
type AttemptResult = { stage: 'join' | 'pay'; status: number; code?: number };

describe('拼团成团竞态（CI 并发）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let activityId: number;
  let groupId: number;
  let agents: Agent[];
  let exclusiveActivityId: number;
  let exclusiveGroupId: number;

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

    // 双人团 + 已有一人（仅差一人成团）
    const activity = await prisma.grouponActivity.create({
      data: {
        courseId: COURSE_TYPESCRIPT.id,
        name: `并发拼团-${SUFFIX}`,
        priceCents: 6900,
        targetSize: 2,
        startAt: new Date(Date.now() - HOUR_MS),
        endAt: new Date(Date.now() + HOUR_MS),
        status: 'ongoing',
      },
    });
    activityId = activity.id;
    const group = await prisma.grouponGroup.create({
      data: {
        activityId,
        status: 'pending',
        memberCount: 1,
        expiresAt: activity.endAt,
      },
    });
    groupId = group.id;

    // 三人团（未满），用于同一订单并发支付计数校验
    const exclusiveActivity = await prisma.grouponActivity.create({
      data: {
        courseId: COURSE_TYPESCRIPT.id,
        name: `重复支付-${SUFFIX}`,
        priceCents: 6900,
        targetSize: 3,
        startAt: new Date(Date.now() - HOUR_MS),
        endAt: new Date(Date.now() + HOUR_MS),
        status: 'ongoing',
      },
    });
    exclusiveActivityId = exclusiveActivity.id;
    const exclusiveGroup = await prisma.grouponGroup.create({
      data: {
        activityId: exclusiveActivityId,
        status: 'pending',
        memberCount: 0,
        expiresAt: exclusiveActivity.endAt,
      },
    });
    exclusiveGroupId = exclusiveGroup.id;

    // 直接建号并登录，避免注册接口按 IP 限流
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    agents = [];
    for (let index = 0; index < USER_COUNT; index += 1) {
      const email = `race-${SUFFIX}-${index}@test.com`;
      await prisma.user.create({
        data: { email, nickname: `并发${index}`, passwordHash },
      });
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      agents.push(agent);
    }
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // 加入并发起支付：加入失败直接返回加入结果
  const joinAndPay = async (
    agent: Agent,
    index: number,
  ): Promise<AttemptResult> => {
    const join = await agent
      .post(`/api/v1/groupons/${activityId}/groups/${groupId}/join`)
      .set('Idempotency-Key', `race-join-${SUFFIX}-${index}`);
    if (join.status !== 201) {
      return {
        stage: 'join',
        status: join.status,
        code: (join.body as { code?: number }).code,
      };
    }
    const pay = await agent.post(
      `/api/v1/orders/${(join.body as { data: { order: { id: number } } }).data.order.id}/pay`,
    );
    return {
      stage: 'pay',
      status: pay.status,
      code: (pay.body as { code?: number }).code,
    };
  };

  it('N 人并发加入仅差一人团，恰好一人成团且 memberCount 精确', async () => {
    const results = await Promise.all(
      agents
        .slice(0, 10)
        .map((agent, index) => joinAndPay(agent, index)),
    );

    // 恰好一次支付成功
    expect(results.filter((item) => item.status === 200)).toHaveLength(1);
    // 其余 9 人收到团已满（加入阶段或支付阶段）
    expect(
      results.filter((item) => item.code === 5001),
    ).toHaveLength(9);

    const group = await prisma.grouponGroup.findUnique({
      where: { id: groupId },
    });
    expect(group!.memberCount).toBe(2);
    expect(group!.status).toBe('success');
  });

  it('并发支付同一成员订单不会重复计数', async () => {
    const agent = agents[10];
    const joined = await agent
      .post(
        `/api/v1/groupons/${exclusiveActivityId}/groups/${exclusiveGroupId}/join`,
      )
      .set('Idempotency-Key', `race-solo-${SUFFIX}`)
      .expect(201);
    const orderId = joined.body.data.order.id as number;

    // 同一订单并发支付：支付天然幂等，全部返回已支付结果
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        agent.post(`/api/v1/orders/${orderId}/pay`),
      ),
    );
    expect(results.every((res) => res.status === 200)).toBe(true);

    const group = await prisma.grouponGroup.findUnique({
      where: { id: exclusiveGroupId },
    });
    expect(group!.memberCount).toBe(1);
    expect(group!.status).toBe('pending');
  });
});
