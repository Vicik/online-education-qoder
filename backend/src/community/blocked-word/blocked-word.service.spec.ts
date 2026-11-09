import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockedWordService } from './blocked-word.service';

// 管理端写操作上下文（模拟已登录管理员）
const CTX = { actorId: 9, ip: '127.0.0.1', requestId: 'req-1' };

// 构建被测服务及 Prisma/审计替身
function setup() {
  // Prisma 替身：仅暴露屏蔽词与审计所需方法
  const prisma = {
    blockedWord: {
      findMany: jest.fn(), // 匹配 / 列表查询
      findUnique: jest.fn(), // 按 id 查询
      count: jest.fn(), // 列表总数
      create: jest.fn(), // 新增
      update: jest.fn(), // 修改 / 启停
      delete: jest.fn(), // 删除
    },
  };
  // 审计替身：避免真实落库
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new BlockedWordService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { prisma, audit, service };
}

describe('BlockedWordService.assertAllowed', () => {
  it('包含匹配忽略英文大小写，命中返回全部命中词', async () => {
    const { prisma, service } = setup();
    prisma.blockedWord.findMany.mockResolvedValue([
      { word: '广告' },
      { word: 'Viagra' },
    ]);

    await expect(service.assertAllowed('这里有广告')).rejects.toMatchObject({
      bizCode: 7001,
      status: 422,
      details: ['广告'],
    });
    await expect(service.assertAllowed('buy VIAGRA now')).rejects.toMatchObject(
      {
        bizCode: 7001,
        details: ['Viagra'],
      },
    );
    await expect(service.assertAllowed('正常内容')).resolves.toBeUndefined();
  });

  it('一次命中多个词时返回完整词表', async () => {
    const { prisma, service } = setup();
    prisma.blockedWord.findMany.mockResolvedValue([
      { word: '广告' },
      { word: '代购' },
    ]);

    await expect(service.assertAllowed('广告代购')).rejects.toMatchObject({
      bizCode: 7001,
      details: ['广告', '代购'],
    });
  });

  it('停用词不参与匹配', async () => {
    const { prisma, service } = setup();
    prisma.blockedWord.findMany.mockResolvedValue([
      { word: '广告', status: 'disabled' },
    ]);

    await expect(service.assertAllowed('这里有广告')).resolves.toBeUndefined();
  });

  it('仅查询启用状态的词（修改立即生效，无缓存）', async () => {
    const { prisma, service } = setup();
    prisma.blockedWord.findMany.mockResolvedValue([]);

    await service.assertAllowed('正常内容');

    expect(prisma.blockedWord.findMany).toHaveBeenCalledWith({
      where: { status: 'enabled' },
    });
  });
});

describe('BlockedWordService 管理端 CRUD', () => {
  it('create 落库并写审计 blocked_word.create', async () => {
    const { prisma, audit, service } = setup();
    prisma.blockedWord.create.mockResolvedValue({
      id: 3,
      word: '广告',
      status: 'enabled',
    });

    await expect(service.create(' 广告 ', CTX)).resolves.toEqual({
      id: 3,
      word: '广告',
      status: 'enabled',
    });
    expect(prisma.blockedWord.create).toHaveBeenCalledWith({
      data: { word: '广告' },
      select: { id: true, word: true, status: true },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 9,
        action: 'blocked_word.create',
        targetType: 'blocked_word',
        targetId: 3,
      }),
    );
  });

  it('create 词重复抛 1001/409', async () => {
    const { prisma, service } = setup();
    prisma.blockedWord.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.create('广告', CTX)).rejects.toMatchObject({
      bizCode: 1001,
      status: 409,
    });
  });

  it('空词抛 1001', async () => {
    const { service } = setup();

    await expect(service.create('   ', CTX)).rejects.toMatchObject({
      bizCode: 1001,
    });
  });

  it('update 改状态写审计 blocked_word.enable/disable', async () => {
    const { prisma, audit, service } = setup();
    prisma.blockedWord.findUnique.mockResolvedValue({
      id: 3,
      word: '广告',
      status: 'enabled',
    });
    prisma.blockedWord.update.mockResolvedValue({
      id: 3,
      word: '广告',
      status: 'disabled',
    });

    await service.update(3, { status: 'disabled' }, CTX);

    expect(prisma.blockedWord.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { status: 'disabled' },
      select: { id: true, word: true, status: true },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'blocked_word.disable',
        targetId: 3,
      }),
    );
  });

  it('update 不存在的词抛 404', async () => {
    const { prisma, service } = setup();
    prisma.blockedWord.findUnique.mockResolvedValue(null);

    await expect(
      service.update(99, { status: 'enabled' }, CTX),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('remove 删除并写审计 blocked_word.delete', async () => {
    const { prisma, audit, service } = setup();
    prisma.blockedWord.findUnique.mockResolvedValue({
      id: 3,
      word: '广告',
      status: 'enabled',
    });
    prisma.blockedWord.delete.mockResolvedValue({});

    await service.remove(3, CTX);

    expect(prisma.blockedWord.delete).toHaveBeenCalledWith({
      where: { id: 3 },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'blocked_word.delete',
        targetId: 3,
      }),
    );
  });

  it('list 按状态过滤并分页', async () => {
    const { prisma, service } = setup();
    prisma.blockedWord.count.mockResolvedValue(1);
    prisma.blockedWord.findMany.mockResolvedValue([
      { id: 1, word: '广告', status: 'enabled' },
    ]);

    await expect(
      service.list('enabled', { page: 2, pageSize: 10 }),
    ).resolves.toEqual({
      items: [{ id: 1, word: '广告', status: 'enabled' }],
      total: 1,
      page: 2,
      pageSize: 10,
    });
    expect(prisma.blockedWord.findMany).toHaveBeenCalledWith({
      where: { status: 'enabled' },
      select: { id: true, word: true, status: true },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
  });
});
