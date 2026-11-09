import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import {
  COURSE_TYPESCRIPT,
  DEMO_ADMIN,
  GROUPON_ACTIVITY,
  GROUPON_GROUP_ONE_SHORT,
} from '../../prisma/seed-data';

// 本次运行唯一后缀：隔离账号与幂等键，避免重复执行冲突
const SUFFIX = Date.now();
// 测试账号统一密码（满足 8–64 位策略）
const PASSWORD = 'Passw0rd1';
// 一小时毫秒数
const HOUR_MS = 60 * 60 * 1000;

describe('拼团（CI 集成，基于种子）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  // 加入种子「仅差一人团」的学员会话
  let joiner: ReturnType<typeof request.agent>;
  // 管理员会话
  let admin: ReturnType<typeof request.agent>;
  // 加入种子团时生成的订单 id
  let joinedOrderId: number;
  // 管理端创建的活动 id（用于后续编辑/取消）
  let createdActivityId: number;

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

    // 直接建号并登录，避免注册接口按 IP 限流影响 CI 全量用例
    const joinerEmail = `groupon-joiner-${SUFFIX}@test.com`;
    await prisma.user.create({
      data: {
        email: joinerEmail,
        nickname: '拼团测试',
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      },
    });
    joiner = request.agent(app.getHttpServer());
    await joiner
      .post('/api/v1/auth/login')
      .send({ email: joinerEmail, password: PASSWORD })
      .expect(200);

    // 管理员登录（含 TOTP）
    admin = request.agent(app.getHttpServer());
    const adminRow = await prisma.user.findUnique({
      where: { email: DEMO_ADMIN.email },
    });
    await admin
      .post('/api/v1/auth/login')
      .send({
        email: DEMO_ADMIN.email,
        password: DEMO_ADMIN.password,
        totpCode: authenticator.generate(adminRow!.totpSecret!),
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('活动列表/详情可见种子进行中活动与仅差一人团', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/groupons')
      .expect(200);
    expect(list.body.data.items[0].status).toBe('ongoing');
    expect(list.body.data.items[0].id).toBe(GROUPON_ACTIVITY.id);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/groupons/${GROUPON_ACTIVITY.id}`)
      .expect(200);
    expect(detail.body.data.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: GROUPON_GROUP_ONE_SHORT.id,
          status: 'pending',
          memberCount: 1,
          targetSize: GROUPON_ACTIVITY.targetSize,
        }),
      ]),
    );
  });

  it('加入仅差一人团 → 支付 → 成团 → 学习权限生效', async () => {
    // 加入种子团（仅差一人）
    const joined = await joiner
      .post(
        `/api/v1/groupons/${GROUPON_ACTIVITY.id}/groups/${GROUPON_GROUP_ONE_SHORT.id}/join`,
      )
      .set('Idempotency-Key', `itg-grp-j1-${SUFFIX}`)
      .expect(201);
    joinedOrderId = joined.body.data.order.id;
    expect(joined.body.data.group.memberCount).toBe(1);

    // 支付后行锁计团并成团
    await joiner
      .post(`/api/v1/orders/${joinedOrderId}/pay`)
      .expect(200);

    const group = await prisma.grouponGroup.findUnique({
      where: { id: GROUPON_GROUP_ONE_SHORT.id },
    });
    expect(group!.status).toBe('success');
    expect(group!.memberCount).toBe(2);
    expect(group!.formedAt).not.toBeNull();

    // 成团后可学习
    const chapter = await prisma.chapter.findFirst({
      where: { courseId: COURSE_TYPESCRIPT.id },
      orderBy: { sortOrder: 'asc' },
    });
    await joiner
      .get(
        `/api/v1/courses/${COURSE_TYPESCRIPT.id}/chapters/${chapter!.id}/content`,
      )
      .expect(200);
  });

  it('同一用户同一活动二次参团被拒（409）', async () => {
    // 新建一个待成团团组，验证唯一约束语义而非团已满
    const another = await prisma.grouponGroup.create({
      data: {
        activityId: GROUPON_ACTIVITY.id,
        status: 'pending',
        memberCount: 0,
        expiresAt: new Date(Date.now() + HOUR_MS),
      },
    });

    const res = await joiner
      .post(
        `/api/v1/groupons/${GROUPON_ACTIVITY.id}/groups/${another.id}/join`,
      )
      .set('Idempotency-Key', `itg-grp-dup-${SUFFIX}`)
      .expect(409);
    expect(res.body.code).toBe(5001);
  });

  it('管理端创建活动（仅已发布课程）→ 编辑（仅未开始）', async () => {
    // 草稿课程不可创建
    await admin
      .post('/api/v1/admin/groupons')
      .send({
        courseId: 2,
        name: '草稿课拼团',
        priceCents: 1000,
        targetSize: 2,
        startAt: new Date(Date.now() + 5 * HOUR_MS).toISOString(),
        endAt: new Date(Date.now() + 7 * HOUR_MS).toISOString(),
      })
      .expect(422);

    // 已发布课程 + 不与种子活动重叠的时间窗
    const created = await admin
      .post('/api/v1/admin/groupons')
      .send({
        courseId: COURSE_TYPESCRIPT.id,
        name: `管理端拼团-${SUFFIX}`,
        priceCents: 5900,
        targetSize: 3,
        startAt: new Date(Date.now() + 5 * HOUR_MS).toISOString(),
        endAt: new Date(Date.now() + 7 * HOUR_MS).toISOString(),
      })
      .expect(201);
    createdActivityId = created.body.data.id;
    expect(created.body.data).toMatchObject({
      status: 'not_started',
      courseName: COURSE_TYPESCRIPT.name,
    });

    // 未开始活动可编辑（version 乐观锁）
    const updated = await admin
      .put(`/api/v1/admin/groupons/${createdActivityId}`)
      .send({ version: created.body.data.version, name: '改名后的拼团' })
      .expect(200);
    expect(updated.body.data.name).toBe('改名后的拼团');

    // 进行中的种子活动不可编辑
    const ongoing = await prisma.grouponActivity.findUnique({
      where: { id: GROUPON_ACTIVITY.id },
    });
    await admin
      .put(`/api/v1/admin/groupons/${GROUPON_ACTIVITY.id}`)
      .send({ version: ongoing!.version, name: '非法改名' })
      .expect(422);

    // 未开始活动可取消
    const cancelled = await admin
      .post(`/api/v1/admin/groupons/${createdActivityId}/cancel`)
      .send({})
      .expect(200);
    expect(cancelled.body.data.status).toBe('cancelled');
  });
});
