import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionAdminService } from './question.admin.service';

// 管理端写操作上下文（模拟已登录管理员）
const CTX = { actorId: 9, ip: '127.0.0.1', requestId: 'req-exam-q' };

// 两个合法选项
const twoOptions = [
  { key: 'A', text: '选项 A' },
  { key: 'B', text: '选项 B' },
];
// 三个合法选项
const threeOptions = [
  { key: 'A', text: '选项 A' },
  { key: 'B', text: '选项 B' },
  { key: 'C', text: '选项 C' },
];

// 题库行构造：默认单选、答案 A、5 分、启用
function questionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    type: 'single',
    stem: '题干',
    options: twoOptions,
    answer: ['A'],
    analysis: '解析',
    score: 5,
    status: 'enabled',
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// 构建被测服务及 Prisma/审计替身
function setup() {
  // 题目表替身
  const prisma = {
    question: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  // 审计替身
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // 被测服务
  const service = new QuestionAdminService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { prisma, audit, service };
}

describe('QuestionAdminService.create', () => {
  it('选项不足 2 个返回 1001', async () => {
    const { service } = setup();
    await expect(
      service.create({
        type: 'single',
        stem: 's',
        options: [{ key: 'A', text: 'a' }],
        answer: ['A'],
        analysis: 'x',
        score: 5,
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('单选答案多于 1 个返回 1001', async () => {
    const { service } = setup();
    await expect(
      service.create({
        type: 'single',
        stem: 's',
        options: twoOptions,
        answer: ['A', 'B'],
        analysis: 'x',
        score: 5,
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('多选答案少于 2 个返回 1001', async () => {
    const { service } = setup();
    await expect(
      service.create({
        type: 'multiple',
        stem: 's',
        options: threeOptions,
        answer: ['A'],
        analysis: 'x',
        score: 5,
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('选项 key 重复或答案不在选项中返回 1001', async () => {
    const { service } = setup();
    await expect(
      service.create({
        type: 'multiple',
        stem: 's',
        options: [
          { key: 'A', text: 'a' },
          { key: 'A', text: 'b' },
        ],
        answer: ['A', 'B'],
        analysis: 'x',
        score: 5,
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });

    await expect(
      service.create({
        type: 'single',
        stem: 's',
        options: twoOptions,
        answer: ['C'],
        analysis: 'x',
        score: 5,
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('合法题目默认启用并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.question.create.mockResolvedValue(questionRow());

    const created = await service.create(
      {
        type: 'single',
        stem: 's',
        options: twoOptions,
        answer: ['A'],
        analysis: 'x',
        score: 5,
      },
      CTX,
    );

    expect(created).toMatchObject({ id: 1, status: 'enabled', score: 5 });
    expect(prisma.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'single',
        answer: ['A'],
        score: 5,
        status: 'enabled',
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 9,
        action: 'question.create',
        targetType: 'question',
        targetId: 1,
        requestId: 'req-exam-q',
      }),
    );
  });
});

describe('QuestionAdminService.update', () => {
  it('score 入参被忽略：更新语句不含分值', async () => {
    const { prisma, service } = setup();
    prisma.question.findUnique.mockResolvedValue(questionRow());
    prisma.question.updateMany.mockResolvedValue({ count: 1 });
    prisma.question.findUniqueOrThrow.mockResolvedValue(questionRow());

    await service.update(1, { version: 1, score: 99 });

    // 更新数据中不得出现 score，且版本自增
    const call = prisma.question.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 1, version: 1 });
    expect(call.data).not.toHaveProperty('score');
    expect(call.data.version).toEqual({ increment: 1 });
  });

  it('version 不一致返回 409（4004）', async () => {
    const { prisma, service } = setup();
    prisma.question.findUnique.mockResolvedValue(questionRow({ version: 3 }));

    await expect(
      service.update(1, { version: 1, stem: '新题干' }),
    ).rejects.toMatchObject({ bizCode: 4004, status: 409 });
  });

  it('部分更新按合并结果校验：多选只剩 1 个答案返回 422', async () => {
    const { prisma, service } = setup();
    prisma.question.findUnique.mockResolvedValue(
      questionRow({ type: 'multiple', answer: ['A', 'B'] }),
    );

    await expect(
      service.update(1, { version: 1, answer: ['A'] }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
  });

  it('题目不存在返回 404', async () => {
    const { prisma, service } = setup();
    prisma.question.findUnique.mockResolvedValue(null);

    await expect(service.getDetail(999)).rejects.toMatchObject({
      bizCode: 1002,
      status: 404,
    });
  });
});

describe('QuestionAdminService.enable/disable', () => {
  it('状态流转并分别写 question.enable/question.disable 审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.question.findUnique.mockResolvedValue(
      questionRow({ status: 'disabled' }),
    );
    prisma.question.update
      .mockResolvedValueOnce(questionRow({ status: 'enabled', version: 2 }))
      .mockResolvedValueOnce(questionRow({ status: 'disabled', version: 3 }));

    await expect(service.enable(1, CTX)).resolves.toMatchObject({
      status: 'enabled',
    });
    await expect(service.disable(1, CTX)).resolves.toMatchObject({
      status: 'disabled',
    });

    expect(audit.log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: 'question.enable', targetId: 1 }),
    );
    expect(audit.log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'question.disable', targetId: 1 }),
    );
  });
});
