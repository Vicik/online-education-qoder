const mockFakeClient = {
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  user: { findMany: jest.fn() },
  $queryRaw: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockFakeClient),
}));

import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';

type AnyPrisma = PrismaService & {
  user: { findMany: (...args: unknown[]) => Promise<unknown> };
  $queryRaw: (...args: unknown[]) => Promise<unknown>;
};

describe('PrismaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFakeClient.$connect.mockResolvedValue(undefined);
    mockFakeClient.$disconnect.mockResolvedValue(undefined);
  });

  it('客户端未生成时构造不抛错', () => {
    expect(() => new PrismaService()).not.toThrow();
    expect(PrismaClient).not.toHaveBeenCalled();
  });

  it('then 探测不触发客户端实例化', () => {
    const service = new PrismaService();

    expect((service as AnyPrisma & { then?: unknown }).then).toBeUndefined();
    expect(PrismaClient).not.toHaveBeenCalled();
  });

  it('Nest 生命周期钩子探测不触发客户端实例化', () => {
    const service = new PrismaService() as PrismaService &
      Record<string, unknown>;

    expect(service.onApplicationBootstrap).toBeUndefined();
    expect(service.beforeApplicationShutdown).toBeUndefined();
    expect(service.onApplicationShutdown).toBeUndefined();
    expect(PrismaClient).not.toHaveBeenCalled();
  });

  it('symbol 属性探测不触发客户端实例化', () => {
    const service = new PrismaService() as PrismaService & {
      [key: symbol]: unknown;
    };

    expect(service[Symbol.toStringTag]).toBeUndefined();
    expect(PrismaClient).not.toHaveBeenCalled();
  });

  it('模型 delegate 转发到内部客户端', async () => {
    mockFakeClient.user.findMany.mockResolvedValue([{ id: 1 }]);
    const service = new PrismaService();

    await expect((service as AnyPrisma).user.findMany()).resolves.toEqual([
      { id: 1 },
    ]);
    expect(mockFakeClient.user.findMany).toHaveBeenCalled();
  });

  it('$queryRaw 等客户端方法转发', async () => {
    mockFakeClient.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const service = new PrismaService();

    await expect((service as AnyPrisma).$queryRaw`SELECT 1`).resolves.toEqual([
      { '?column?': 1 },
    ]);
    expect(mockFakeClient.$queryRaw).toHaveBeenCalled();
  });

  it('onModuleInit 建连失败只告警不抛出', async () => {
    mockFakeClient.$connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const service = new PrismaService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('onModuleInit 成功后 onModuleDestroy 断开连接', async () => {
    const service = new PrismaService();
    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(mockFakeClient.$disconnect).toHaveBeenCalled();
  });
});
