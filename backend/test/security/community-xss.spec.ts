import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { sessionMiddleware } from '../../src/auth/session.middleware';
import { loadConfig } from '../../src/config/configuration';
import { RedisService } from '../../src/redis/redis.service';
import { DEMO_USER } from '../../prisma/seed-data';

// 本次运行唯一后缀，避免幂等键与历史运行冲突
const SUFFIX = String(Date.now());

describe('社区 XSS 防护（安全断言）', () => {
  let app: INestApplication;
  // 保持学员会话的 agent
  let author: ReturnType<typeof request.agent>;

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

    // 登录种子学员
    author = request.agent(app.getHttpServer());
    await author
      .post('/api/v1/auth/login')
      .send({ email: DEMO_USER.email, password: DEMO_USER.password })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('帖子/评论中的 script 与事件属性被剥离', async () => {
    const created = await author
      .post('/api/v1/posts')
      .set('Idempotency-Key', `itg-xss-${SUFFIX}-1`)
      .send({
        content:
          '<script>alert(1)</script><p onclick="steal()">正文</p><a href="javascript:alert(2)">链接</a>',
      })
      .expect(201);

    // 创建响应即已净化
    expect(created.body.data.content).not.toContain('<script>');
    expect(created.body.data.content).not.toContain('onclick');
    expect(created.body.data.content).not.toContain('javascript:');

    // 信息流整体响应不含危险片段
    const feed = await request(app.getHttpServer())
      .get('/api/v1/posts')
      .expect(200);
    const raw = JSON.stringify(feed.body);
    expect(raw).not.toContain('<script>');
    expect(raw).not.toContain('onclick');
    expect(raw).not.toContain('javascript:');

    // 详情同样已净化
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/posts/${created.body.data.id}`)
      .expect(200);
    expect(detail.body.data.content).not.toContain('javascript:');
  });

  it('评论内容中的 script 被剥离', async () => {
    // 新建帖子承载评论
    const post = await author
      .post('/api/v1/posts')
      .set('Idempotency-Key', `itg-xss-${SUFFIX}-2`)
      .send({ content: '承载评论的帖子' })
      .expect(201);

    const comment = await author
      .post(`/api/v1/posts/${post.body.data.id}/comments`)
      .set('Idempotency-Key', `itg-xss-${SUFFIX}-3`)
      .send({ content: '<img src="x" onerror="alert(1)"><script>alert(2)</script>评论' })
      .expect(201);

    expect(comment.body.data.content).not.toContain('<script>');
    expect(comment.body.data.content).not.toContain('onerror');
  });
});
