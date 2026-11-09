import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import { DEMO_ADMIN } from '../../prisma/seed-data';

// 每次运行唯一的学员邮箱，避免注册冲突
const TEST_EMAIL = `exam-leak-${Date.now()}@test.com`;
// 测试账号密码（满足 8–64 位策略）
const TEST_PASSWORD = 'Passw0rd1';
// 本次运行唯一标题后缀
const SUFFIX = String(Date.now());

// 断言响应中不含答案/解析字段：考试安全红线（§10.5）
const assertNoLeak = (obj: unknown) => {
  // 响应序列化文本
  const text = JSON.stringify(obj);
  expect(text).not.toContain('"answer"');
  expect(text).not.toContain('"analysis"');
};

describe('考试答案防泄露（安全断言）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  // 保持管理员会话的 agent
  let admin: ReturnType<typeof request.agent>;
  // 保持学员会话的 agent
  let user: ReturnType<typeof request.agent>;
  // 已发布考试 id
  let examId: number;
  // 题目 id
  let questionId: number;
  // 开始考试得到的记录 id
  let attemptId: number;

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

    // 管理员登录（含 TOTP）
    admin = request.agent(app.getHttpServer());
    const secret = await prisma.user
      .findUnique({ where: { email: DEMO_ADMIN.email } })
      .then((row) => row!.totpSecret!);
    await admin
      .post('/api/v1/auth/login')
      .send({
        email: DEMO_ADMIN.email,
        password: DEMO_ADMIN.password,
        totpCode: authenticator.generate(secret),
      })
      .expect(200);

    // 注册并登录一个全新学员
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        confirmPassword: TEST_PASSWORD,
        nickname: '安全断言',
      })
      .expect(201);
    user = request.agent(app.getHttpServer());
    await user
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);

    // 建题 → 组卷 → 发布
    const question = await admin
      .post('/api/v1/admin/questions')
      .send({
        type: 'single',
        stem: `1+1=? ${SUFFIX}`,
        options: [
          { key: 'A', text: '2' },
          { key: 'B', text: '3' },
        ],
        answer: ['A'],
        analysis: '显然',
        score: 5,
      })
      .expect(201);
    questionId = question.body.data.id;
    const exam = await admin
      .post('/api/v1/admin/exams')
      .send({
        title: `安全断言 ${SUFFIX}`,
        durationMin: 30,
        passScore: 5,
        questionIds: [questionId],
      })
      .expect(201);
    examId = exam.body.data.id;
    await admin.post(`/api/v1/admin/exams/${examId}/publish`).expect(200);

    // 开始考试（后续断言复用同一条记录）
    const start = await user
      .post(`/api/v1/exams/${examId}/attempts`)
      .expect(201);
    attemptId = start.body.data.attemptId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('考试详情与开始接口响应不含 answer/analysis', async () => {
    // 考试列表与详情
    const list = await user.get('/api/v1/exams').expect(200);
    assertNoLeak(list.body.data);
    const detail = await user.get(`/api/v1/exams/${examId}`).expect(200);
    assertNoLeak(detail.body.data);

    // 开始考试（重放仍返回首次记录）
    const start = await user
      .post(`/api/v1/exams/${examId}/attempts`)
      .expect(201);
    expect(start.body.data.attemptId).toBe(attemptId);
    assertNoLeak(start.body.data);
  });

  it('未交卷访问 result 422 且不含答案', async () => {
    const res = await user
      .get(`/api/v1/exams/${examId}/attempts/${attemptId}/result`)
      .expect(422);
    assertNoLeak(res.body);
  });

  it('交卷后才返回正确答案与解析', async () => {
    await user
      .post(`/api/v1/exams/${examId}/attempts/${attemptId}/submit`)
      .send({ answers: { [questionId]: ['A'] } })
      .expect(200);

    const result = await user
      .get(`/api/v1/exams/${examId}/attempts/${attemptId}/result`)
      .expect(200);
    expect(result.body.data.score).toBe(5);
    expect(result.body.data.questions[0].correctAnswers).toEqual(['A']);
    expect(result.body.data.questions[0].analysis).toBe('显然');
  });
});
