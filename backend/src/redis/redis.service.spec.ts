import { ConfigService } from '@nestjs/config';

const client = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  decr: jest.fn(),
  expire: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  smembers: jest.fn(),
  eval: jest.fn(),
  on: jest.fn(),
  quit: jest.fn(),
  connect: jest.fn(),
};

jest.mock('ioredis', () => ({
  Redis: jest.fn(() => client),
}));

import { Redis } from 'ioredis';
import { Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

function setup() {
  const config = {
    get: () => 'redis://localhost:6379',
  } as unknown as ConfigService;
  const service = new RedisService(config);
  service.onModuleInit();
  return service;
}

describe('RedisService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.connect.mockResolvedValue(undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('按配置的 REDIS_URL 建连并监听 error，避免未捕获错误崩溃进程', () => {
    setup();
    expect(Redis).toHaveBeenCalledWith(
      'redis://localhost:6379',
      expect.objectContaining({ lazyConnect: true }),
    );
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('建连失败不阻断启动（/healthz 仍需可用）', async () => {
    const config = { get: () => 'redis://bad' } as unknown as ConfigService;
    const service = new RedisService(config);
    (client as unknown as { connect: jest.Mock }).connect = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('setNxEx 用 SET key val EX ttl NX 原子写入', async () => {
    client.set.mockResolvedValue('OK');
    const service = setup();

    await expect(service.setNxEx('k', 'v', 30)).resolves.toBe(true);
    expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', 30, 'NX');
  });

  it('setNxEx 未抢到时返回 false', async () => {
    client.set.mockResolvedValue(null);
    const service = setup();

    await expect(service.setNxEx('k', 'v', 30)).resolves.toBe(false);
  });

  it('delIfValue 用 Lua 原子比对删除，避免误删他人锁', async () => {
    client.eval.mockResolvedValue(1);
    const service = setup();

    await service.delIfValue('k', 'token');
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get"'),
      1,
      'k',
      'token',
    );
  });

  it('set 带 TTL 时传 EX', async () => {
    client.set.mockResolvedValue('OK');
    const service = setup();

    await service.set('k', 'v', 60);
    expect(client.set).toHaveBeenCalledWith('k', 'v', 'EX', 60);
  });

  it('set 不带 TTL 时不传过期参数', async () => {
    client.set.mockResolvedValue('OK');
    const service = setup();

    await service.set('k', 'v');
    expect(client.set).toHaveBeenCalledWith('k', 'v');
  });

  it('透传计数与集合命令', async () => {
    client.incr.mockResolvedValue(3);
    client.decr.mockResolvedValue(1);
    client.sadd.mockResolvedValue(2);
    client.srem.mockResolvedValue(1);
    client.smembers.mockResolvedValue(['a', 'b']);
    client.get.mockResolvedValue('v');
    const service = setup();

    expect(await service.incr('k')).toBe(3);
    expect(await service.decr('k')).toBe(1);
    expect(await service.sadd('s', 'a', 'b')).toBe(2);
    expect(await service.srem('s', 'a')).toBe(1);
    expect(await service.smembers('s')).toEqual(['a', 'b']);
    expect(await service.get('k')).toBe('v');
    await service.expire('k', 10);
    expect(client.expire).toHaveBeenCalledWith('k', 10);
    await service.del('k');
    expect(client.del).toHaveBeenCalledWith('k');
  });
});
