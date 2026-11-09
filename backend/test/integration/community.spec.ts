import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import { DEMO_ADMIN, DEMO_USER } from '../../prisma/seed-data';

// 测试账号密码（满足 8–64 位策略）
const PASSWORD = 'Passw0rd1';
// 本次运行唯一后缀，避免与历史数据冲突
const SUFFIX = String(Date.now());
// 本次运行唯一的屏蔽词，避免重复创建冲突
const BLOCKED_WORD = `违禁词${SUFFIX}`;

describe('社区（CI 集成）', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  // 帖子作者（种子学员）id
  let authorId: number;
  // 帖子作者会话
  let author: ReturnType<typeof request.agent>;
  // 评论/回复者会话
  let commenter: ReturnType<typeof request.agent>;
  // 主流程帖子 id
  let postId: number;
  // 一级评论 id
  let commentId: number;

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
    authorId = demoUser!.id;
    // 登录种子学员
    author = request.agent(app.getHttpServer());
    await author
      .post('/api/v1/auth/login')
      .send({ email: DEMO_USER.email, password: DEMO_USER.password })
      .expect(200);
    // 新注册一个评论者，验证他人视角
    commenter = await registerAndLogin(`community-${SUFFIX}@test.com`);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // 注册并登录一个新学员，返回保持会话的 agent
  const registerAndLogin = async (email: string) => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: PASSWORD,
        confirmPassword: PASSWORD,
        nickname: '社区测试',
      })
      .expect(201);
    // 登录
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return agent;
  };

  // 管理员登录（含 TOTP），返回保持会话的 agent
  const loginAdmin = async () => {
    const agent = request.agent(app.getHttpServer());
    const admin = await prisma.user.findUnique({
      where: { email: DEMO_ADMIN.email },
    });
    await agent
      .post('/api/v1/auth/login')
      .send({
        email: DEMO_ADMIN.email,
        password: DEMO_ADMIN.password,
        totpCode: authenticator.generate(admin!.totpSecret!),
      })
      .expect(200);
    return agent;
  };

  it('发帖 → 评论 → 回复 → 点赞 → 详情两层结构', async () => {
    // 发帖
    const post = await author
      .post('/api/v1/posts')
      .set('Idempotency-Key', `itg-post-${SUFFIX}-1`)
      .send({ content: '大家好，这是一条帖子' })
      .expect(201);
    postId = post.body.data.id;
    expect(post.body.data).toMatchObject({ userId: authorId, likeCount: 0 });

    // 一级评论
    const comment = await author
      .post(`/api/v1/posts/${postId}/comments`)
      .set('Idempotency-Key', `itg-cmt-${SUFFIX}-1`)
      .send({ content: '一级评论' })
      .expect(201);
    commentId = comment.body.data.id;
    expect(comment.body.data.replies).toEqual([]);

    // 回复（挂在一级评论下，@ 作者）
    const reply = await commenter
      .post(`/api/v1/comments/${commentId}/replies`)
      .set('Idempotency-Key', `itg-rpl-${SUFFIX}-1`)
      .send({ content: '回复你', replyToUserId: authorId })
      .expect(201);
    expect(reply.body.data.replyToNickname).toBe(DEMO_USER.nickname);

    // 点赞（幂等：重复点赞不重复计数）
    await commenter.post(`/api/v1/posts/${postId}/like`).expect(200);
    await commenter.post(`/api/v1/posts/${postId}/like`).expect(200);

    const detail = await commenter.get(`/api/v1/posts/${postId}`).expect(200);
    expect(detail.body.data.likeCount).toBe(1);
    expect(detail.body.data.likedByMe).toBe(true);
    expect(detail.body.data.commentCount).toBe(2);
    expect(detail.body.data.comments).toHaveLength(1);
    expect(detail.body.data.comments[0].replies).toHaveLength(1);
    expect(detail.body.data.comments[0].replies[0].replyToNickname).toBe(
      DEMO_USER.nickname,
    );
  });

  it('屏蔽词命中阻止发帖（7001 附词表），停用后立即放行', async () => {
    const admin = await loginAdmin();
    // 新增屏蔽词
    const created = await admin
      .post('/api/v1/admin/blocked-words')
      .send({ word: BLOCKED_WORD })
      .expect(201);
    const wordId = created.body.data.id as number;

    // 命中：422 + code=7001 + data 附命中词
    const res = await author
      .post('/api/v1/posts')
      .set('Idempotency-Key', `itg-post-${SUFFIX}-2`)
      .send({ content: `这里包含${BLOCKED_WORD}` })
      .expect(422);
    expect(res.body.code).toBe(7001);
    expect(res.body.data).toContain(BLOCKED_WORD);

    // 停用后立即生效（无缓存）
    await admin
      .put(`/api/v1/admin/blocked-words/${wordId}`)
      .send({ status: 'disabled' })
      .expect(200);
    await author
      .post('/api/v1/posts')
      .set('Idempotency-Key', `itg-post-${SUFFIX}-3`)
      .send({ content: `这里包含${BLOCKED_WORD}` })
      .expect(201);
  });

  it('删除一级评论级联删除其回复', async () => {
    await author.delete(`/api/v1/comments/${commentId}`).expect(200);

    const detail = await commenter.get(`/api/v1/posts/${postId}`).expect(200);
    const ids = detail.body.data.comments.map(
      (comment: { id: number }) => comment.id,
    );
    expect(ids).not.toContain(commentId);
    expect(detail.body.data.commentCount).toBe(0);
  });

  it('删除他人帖子 403（IDOR）', async () => {
    const res = await commenter
      .delete(`/api/v1/posts/${postId}`)
      .expect(403);
    expect(res.body.code).toBe(2002);
  });

  it('我的帖子仅包含自己发布的帖子', async () => {
    const res = await author.get('/api/v1/user/posts').expect(200);
    const userIds = res.body.data.items.map(
      (item: { userId: number }) => item.userId,
    );
    expect(userIds.every((id: number) => id === authorId)).toBe(true);
    expect(
      res.body.data.items.some((item: { id: number }) => item.id === postId),
    ).toBe(true);
  });
});
