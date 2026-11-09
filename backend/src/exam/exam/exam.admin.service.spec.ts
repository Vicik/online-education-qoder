import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExamAdminService } from './exam.admin.service';

// 管理端写操作上下文（模拟已登录管理员）
const CTX = { actorId: 9, ip: '127.0.0.1', requestId: 'req-exam-admin' };

// 考试行构造：默认草稿、总分 15、及格 10
function examRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: '期中测验',
    description: '',
    durationMin: 30,
    passScore: 10,
    totalScore: 15,
    status: 'draft',
    snapshot: [],
    publishedAt: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// 题库行构造：单选题默认答案 A、5 分
function questionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    type: 'single',
    stem: '题干',
    options: [
      { key: 'A', text: '选项 A' },
      { key: 'B', text: '选项 B' },
    ],
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
  // 数据库替身：考试表 + 题库表
  const prisma = {
    exam: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    question: { findMany: jest.fn() },
  };
  // 审计替身
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  // 被测服务
  const service = new ExamAdminService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { prisma, audit, service };
}

describe('ExamAdminService.create', () => {
  it('及格分超过总分返回 1001，不落库', async () => {
    const { prisma, service } = setup();
    prisma.question.findMany.mockResolvedValue([
      { id: 1, score: 5 },
      { id: 2, score: 10 },
    ]);

    await expect(
      service.create({
        title: 't',
        durationMin: 30,
        passScore: 100,
        questionIds: [1, 2],
      }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    expect(prisma.exam.create).not.toHaveBeenCalled();
  });

  it('合法组卷：总分=题目分值之和，落草稿并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.question.findMany.mockResolvedValue([
      questionRow({ id: 1, score: 5 }),
      questionRow({ id: 2, score: 10 }),
    ]);
    prisma.exam.create.mockResolvedValue(
      examRow({ snapshot: [{ questionId: 1 }, { questionId: 2 }] }),
    );

    await expect(
      service.create(
        {
          title: 't',
          durationMin: 30,
          passScore: 10,
          questionIds: [1, 2],
        },
        CTX,
      ),
    ).resolves.toBeDefined();

    expect(prisma.exam.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'draft',
        totalScore: 15,
        passScore: 10,
      }),
    });
    // 草稿快照按组卷顺序，且不含答案/解析
    const snapshot = prisma.exam.create.mock.calls[0][0].data.snapshot;
    expect(
      snapshot.map((item: { questionId: number }) => item.questionId),
    ).toEqual([1, 2]);
    expect(snapshot[0]).not.toHaveProperty('answer');
    expect(snapshot[0]).not.toHaveProperty('analysis');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'exam.create',
        targetType: 'exam',
        targetId: 1,
      }),
    );
  });

  it('题目重复或题目不可用返回 1001', async () => {
    const { service, prisma } = setup();
    await expect(
      service.create({
        title: 't',
        durationMin: 30,
        passScore: 5,
        questionIds: [1, 1],
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });

    prisma.question.findMany.mockResolvedValue([questionRow({ id: 1 })]);
    await expect(
      service.create({
        title: 't',
        durationMin: 30,
        passScore: 5,
        questionIds: [1, 2],
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });
});

describe('ExamAdminService.publish', () => {
  it('发布冻结快照：合并题库答案/解析并置为 published', async () => {
    const { prisma, audit, service } = setup();
    // 草稿快照（只含组卷信息）
    const draftSnapshot = [
      {
        questionId: 1,
        type: 'single',
        stem: 's1',
        options: [],
        score: 5,
        sortOrder: 1,
      },
      {
        questionId: 2,
        type: 'multiple',
        stem: 's2',
        options: [],
        score: 10,
        sortOrder: 2,
      },
    ];
    prisma.exam.findUnique.mockResolvedValue(
      examRow({ snapshot: draftSnapshot, version: 2 }),
    );
    prisma.question.findMany.mockResolvedValue([
      questionRow({ id: 1, score: 5 }),
      questionRow({
        id: 2,
        type: 'multiple',
        stem: 's2',
        answer: ['A', 'B'],
        analysis: 'x2',
        score: 10,
      }),
    ]);
    prisma.exam.update.mockResolvedValue(
      examRow({ status: 'published', snapshot: [], publishedAt: new Date() }),
    );

    await service.publish(1, CTX);

    expect(prisma.exam.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        status: 'published',
        snapshot: expect.any(Array),
        publishedAt: expect.any(Date),
      }),
    });
    // 合并后的快照包含答案与解析，且保留草稿顺序
    const merged = prisma.exam.update.mock.calls[0][0].data.snapshot;
    expect(
      merged.map((item: { questionId: number }) => item.questionId),
    ).toEqual([1, 2]);
    expect(merged[0].answer).toEqual(['A']);
    expect(merged[1].analysis).toBe('x2');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'exam.publish', targetId: 1 }),
    );
  });

  it('非草稿考试不可发布（422）', async () => {
    const { prisma, service } = setup();
    prisma.exam.findUnique.mockResolvedValue(examRow({ status: 'published' }));

    await expect(service.publish(1)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
  });
});

describe('ExamAdminService.update', () => {
  it('已发布考试不可编辑（422）', async () => {
    const { prisma, service } = setup();
    prisma.exam.findUnique.mockResolvedValue(examRow({ status: 'published' }));

    await expect(
      service.update(1, { version: 1, title: '新标题' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
  });

  it('version 不一致返回 409', async () => {
    const { prisma, service } = setup();
    prisma.exam.findUnique.mockResolvedValue(examRow({ version: 3 }));

    await expect(
      service.update(1, { version: 1, title: '新标题' }),
    ).rejects.toMatchObject({ bizCode: 4004, status: 409 });
  });

  it('草稿重新组卷：重算总分并校验及格分', async () => {
    const { prisma, service } = setup();
    prisma.exam.findUnique.mockResolvedValue(
      examRow({
        snapshot: [
          {
            questionId: 1,
            type: 'single',
            stem: 's1',
            options: [],
            score: 5,
            sortOrder: 1,
          },
          {
            questionId: 2,
            type: 'multiple',
            stem: 's2',
            options: [],
            score: 10,
            sortOrder: 2,
          },
        ],
      }),
    );
    prisma.question.findMany.mockResolvedValue([
      questionRow({ id: 1, score: 5 }),
      questionRow({ id: 2, score: 10 }),
    ]);
    prisma.exam.updateMany.mockResolvedValue({ count: 1 });
    prisma.exam.findUniqueOrThrow.mockResolvedValue(
      examRow({ snapshot: [{ questionId: 2 }, { questionId: 1 }] }),
    );

    await service.update(1, { version: 1, questionIds: [2, 1] });

    const data = prisma.exam.updateMany.mock.calls[0][0].data;
    expect(data.totalScore).toBe(15);
    expect(
      data.snapshot.map((item: { questionId: number }) => item.questionId),
    ).toEqual([2, 1]);
  });
});
