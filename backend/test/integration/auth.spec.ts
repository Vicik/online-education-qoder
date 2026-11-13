import { INestApplication } from "@nestjs/common";
import { TrimmingValidationPipe } from "../../src/common/validation/trimming-validation.pipe";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { sessionMiddleware } from "../../src/auth/session.middleware";
import { loadConfig } from "../../src/config/configuration";
import { RedisService } from "../../src/redis/redis.service";
import { DEMO_ADMIN } from "../../prisma/seed-data";

// 本文件使用的学员账号（每次运行唯一，避免重复注册冲突）
const TEST_EMAIL = `t1-${Date.now()}@test.com`;
// 初始密码
const TEST_PASSWORD = "Passw0rd1";
// 修改后的密码
const NEW_PASSWORD = "NewPassw0rd2";
// 演示管理员密码（与种子一致）
const ADMIN_PASSWORD = DEMO_ADMIN.password;

describe("认证与账号（CI 集成）", () => {
  let app: INestApplication;
  let prisma: PrismaClient;

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
    app.setGlobalPrefix("api/v1");
    await app.init();

    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("未登录访问 /auth/me 返回 401（code=2001）", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .expect(401);
    expect(res.body.code).toBe(2001);
  });

  it("注册 → 不自动登录 → 登录成功返回角色", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        confirmPassword: TEST_PASSWORD,
        nickname: "  测试一  ",
      })
      .expect(201);

    // 注册不建立会话
    await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);

    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    expect(login.body.data.role).toBe("user");
  });

  it("邮箱或密码错误统一提示，不泄露账号存在性", async () => {
    const a = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "ghost@test.com", password: "x1y2z3a4" });
    const b = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: TEST_EMAIL, password: "wrong123" });

    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.code).toBe(2003);
    expect(b.body.code).toBe(2003);
    expect(a.body.message).toBe(b.body.message);
  });

  it("登录限流：同账号第 6 次失败返回 429", async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ email: TEST_EMAIL, password: "wrong123" });
    }

    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: TEST_EMAIL, password: "wrong123" })
      .expect(429);
    expect(res.body.code).toBe(1005);
  });

  it("改密后旧会话全部吊销，需重新登录", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    await agent.get("/api/v1/auth/me").expect(200);

    await agent
      .post("/api/v1/auth/password")
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      })
      .expect(200);

    // 会话已吊销
    await agent.get("/api/v1/auth/me").expect(401);
    // 新密码可重新登录
    await agent
      .post("/api/v1/auth/login")
      .send({ email: TEST_EMAIL, password: NEW_PASSWORD })
      .expect(200);
  });

  it("退出登录即时吊销当前会话", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .send({ email: TEST_EMAIL, password: NEW_PASSWORD })
      .expect(200);
    await agent.get("/api/v1/auth/me").expect(200);

    await agent.post("/api/v1/auth/logout").expect(200);
    await agent.get("/api/v1/auth/me").expect(401);
  });

  it("个人资料可读可改，概览返回五项统计", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .send({ email: TEST_EMAIL, password: NEW_PASSWORD })
      .expect(200);

    const profile = await agent.get("/api/v1/user/profile").expect(200);
    expect(profile.body.data).toMatchObject({
      email: TEST_EMAIL,
      nickname: "测试一",
    });
    expect(profile.body.data.passwordHash).toBeUndefined();

    const updated = await agent
      .put("/api/v1/user/profile")
      .send({ nickname: "测试一改", gender: "male" })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      nickname: "测试一改",
      gender: "male",
    });

    const blankNickname = await agent
      .put("/api/v1/user/profile")
      .send({ nickname: "   ", gender: "male" })
      .expect(400);
    expect(blankNickname.body.code).toBe(1001);

    const overview = await agent.get("/api/v1/user/overview").expect(200);
    expect(overview.body.data).toEqual({
      enrolledCount: 0,
      completedCount: 0,
      favoriteCount: 0,
      couponCount: 0,
      postCount: 0,
    });
  });

  it("管理员仅凭密码登录成功，返回 admin", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: DEMO_ADMIN.email, password: ADMIN_PASSWORD })
      .expect(200);
    expect(login.body.data.role).toBe("admin");
  });

  it("必填字段为纯空格时返回 400（code=1001）", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: `blank-${Date.now()}@test.com`, password: "   " })
      .expect(400);
    expect(login.body.code).toBe(1001);

    const register = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: `blank-${Date.now()}@test.com`,
        password: "Passw0rd1",
        confirmPassword: "Passw0rd1",
        nickname: "   ",
      })
      .expect(400);
    expect(register.body.code).toBe(1001);
  });
});
