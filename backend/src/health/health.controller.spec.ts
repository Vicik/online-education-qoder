import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../common/interceptors/response.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { HealthController } from './health.controller';

const prismaMock = { $queryRaw: jest.fn() };
const redisMock = { ping: jest.fn() };

describe('HealthController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    redisMock.ping.mockResolvedValue('PONG');
  });

  afterAll(async () => {
    await app.close();
  });

  it('/healthz 恒 200', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toMatchObject({ status: 'ok' });
  });

  it('/readyz 依赖就绪时返回 200', async () => {
    const res = await request(app.getHttpServer()).get('/readyz').expect(200);
    expect(res.body.code).toBe(0);
  });

  it('/readyz 数据库不可用返回 503', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('down'));
    const res = await request(app.getHttpServer()).get('/readyz').expect(503);
    expect(res.body).toMatchObject({ code: 1006 });
  });

  it('/readyz Redis 不可用返回 503', async () => {
    redisMock.ping.mockRejectedValueOnce(new Error('down'));
    await request(app.getHttpServer()).get('/readyz').expect(503);
  });
});
