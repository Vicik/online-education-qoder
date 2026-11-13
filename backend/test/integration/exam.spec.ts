import { INestApplication } from '@nestjs/common';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import { DEMO_ADMIN } from '../../prisma/seed-data';

// 每次运行唯一的学员邮箱，避免注册冲突
const TEST_EMAIL = `exam-${Date.now()}@test.com`;
// 测试账号密码（满足 8–64 位策略）
const TEST_PASSWORD = 'Passw0rd1';
// 本次运行唯一标题后缀，避免集成库残留数据干扰
const SUFFIX = String(Date.now());

describe('考试（CI 集成）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  // 保持管理员会话的 agent
  let admin: ReturnType<typeof request.agent>;
  // 保持学员会话的 agent
  let user: ReturnType<typeof request.agent>;
  // 单选题 id
  let singleQid: number;
  // 多选题 id
  let multipleQid: number;
  // 发布后的考试 A id
  let examAId: number;
  // 发布后的考试 B id（用于超时拒绝）
  let examBId: number;
  // 草稿考试 C id（未发布）
  let examCId: number;
  // 首次开始考试 record id
  let attemptId: number;
  // 单选题原始题干（用于快照冻结断言）
  let originalStem: string;

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

    // 管理员登录
    admin = request.agent(app.getHttpServer());
    await admin
      .post('/api/v1/auth/login')
      .send({ email: DEMO_ADMIN.email, password: DEMO_ADMIN.password })
      .expect(200);

    // 注册并登录一个全新学员
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        confirmPassword: TEST_PASSWORD,
        nickname: '考试测试',
      })
      .expect(201);
    user = request.agent(app.getHttpServer());
    await user
      .post('/api/v1/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);

    // 单选题
    originalStem = `1+1=? ${SUFFIX}`;
    const q1 = await admin
      .post('/api/v1/admin/questions')
      .send({
        type: 'single',
        stem: originalStem,
        options: [
          { key: 'A', text: '2' },
          { key: 'B', text: '3' },
        ],
        answer: ['A'],
        analysis: '显然',
        score: 5,
      })
      .expect(201);
    singleQid = q1.body.data.id;

    // 多选题
    const q2 = await admin
      .post('/api/v1/admin/questions')
      .send({
        type: 'multiple',
        stem: `偶数? ${SUFFIX}`,
        options: [
          { key: 'A', text: '2' },
          { key: 'B', text: '4' },
          { key: 'C', text: '5' },
        ],
        answer: ['A', 'B'],
        analysis: '2 和 4',
        score: 10,
      })
      .expect(201);
    multipleQid = q2.body.data.id;

    // 考试 A：用于完整链路与快照冻结
    const examA = await admin
      .post('/api/v1/admin/exams')
      .send({
        title: `期中测验 ${SUFFIX}`,
        durationMin: 30,
        passScore: 10,
        questionIds: [singleQid, multipleQid],
      })
      .expect(201);
    examAId = examA.body.data.id;
    await admin.post(`/api/v1/admin/exams/${examAId}/publish`).expect(200);

    // 考试 B：用于超时拒绝
    const examB = await admin
      .post('/api/v1/admin/exams')
      .send({
        title: `补考 ${SUFFIX}`,
        durationMin: 30,
        passScore: 5,
        questionIds: [singleQid],
      })
      .expect(201);
    examBId = examB.body.data.id;
    await admin.post(`/api/v1/admin/exams/${examBId}/publish`).expect(200);

    // 考试 C：保持草稿，用于“未发布不可开始”
    const examC = await admin
      .post('/api/v1/admin/exams')
      .send({
        title: `草稿考试 ${SUFFIX}`,
        durationMin: 30,
        passScore: 5,
        questionIds: [singleQid],
      })
      .expect(201);
    examCId = examC.body.data.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('管理端建题组卷发布 → 用户开始 → 交卷 → 结果链路', async () => {
    const start = await user
      .post(`/api/v1/exams/${examAId}/attempts`)
      .expect(201);
    attemptId = start.body.data.attemptId;
    expect(start.body.data.questions).toHaveLength(2);
    // 开始接口不得返回答案/解析
    const startJson = JSON.stringify(start.body.data);
    expect(startJson).not.toContain('"answer"');
    expect(startJson).not.toContain('"analysis"');

    const submit = await user
      .post(`/api/v1/exams/${examAId}/attempts/${attemptId}/submit`)
      .send({
        answers: {
          [singleQid]: ['A'],
          [multipleQid]: ['A', 'B'],
        },
      })
      .expect(200);
    expect(submit.body.data).toMatchObject({
      score: 15,
      totalScore: 15,
      passScore: 10,
      passed: true,
    });

    const result = await user
      .get(`/api/v1/exams/${examAId}/attempts/${attemptId}/result`)
      .expect(200);
    expect(result.body.data).toMatchObject({
      score: 15,
      totalScore: 15,
      passed: true,
    });
    expect(result.body.data.questions[0]).toMatchObject({
      id: singleQid,
      userAnswers: ['A'],
      correctAnswers: ['A'],
      analysis: '显然',
    });

    // 我的考试记录包含本次成绩
    const mine = await user.get('/api/v1/user/exams').expect(200);
    expect(
      mine.body.data.items.find(
        (item: { attemptId: number }) => item.attemptId === attemptId,
      ),
    ).toMatchObject({ examId: examAId, score: 15, passed: true });
  });

  it('每人每场唯一：二次开始返回首次 attempt（幂等）', async () => {
    const again = await user
      .post(`/api/v1/exams/${examAId}/attempts`)
      .expect(201);
    expect(again.body.data.attemptId).toBe(attemptId);
  });

  it('修改题库不影响已发布考试快照', async () => {
    // 发布后修改单选题题干
    await admin
      .put(`/api/v1/admin/questions/${singleQid}`)
      .send({ version: 1, stem: `修改后的题干 ${SUFFIX}` })
      .expect(200);

    // 用户端再次开始仍返回发布时快照中的原题干
    const again = await user
      .post(`/api/v1/exams/${examAId}/attempts`)
      .expect(201);
    const question = again.body.data.questions.find(
      (item: { id: number }) => item.id === singleQid,
    );
    expect(question.stem).toBe(originalStem);
  });

  it('超时提交返回 422（code=6002）', async () => {
    const start = await user
      .post(`/api/v1/exams/${examBId}/attempts`)
      .expect(201);
    const attempt = start.body.data.attemptId;
    // 直接把 deadline 改到过去，模拟超时
    await prisma.examAttempt.update({
      where: { id: attempt },
      data: { deadlineAt: new Date(Date.now() - 60_000) },
    });

    const res = await user
      .post(`/api/v1/exams/${examBId}/attempts/${attempt}/submit`)
      .send({ answers: {} })
      .expect(422);
    expect(res.body.code).toBe(6002);
  });

  it('未发布考试不可开始（422）', async () => {
    await user.post(`/api/v1/exams/${examCId}/attempts`).expect(422);
  });

  it('未登录访问考试接口返回 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/exams').expect(401);
  });
});
