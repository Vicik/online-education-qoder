import { PrismaService } from '../../prisma/prisma.service';
import { ExamUserService } from './exam.user.service';

// 完整发布快照：单选 5 分 + 多选 10 分，总分 15
const fullSnapshot = [
  {
    questionId: 1,
    type: 'single',
    stem: '1+1=?',
    options: [
      { key: 'A', text: '2' },
      { key: 'B', text: '3' },
    ],
    score: 5,
    sortOrder: 1,
    answer: ['A'],
    analysis: '显然',
  },
  {
    questionId: 2,
    type: 'multiple',
    stem: '偶数?',
    options: [
      { key: 'A', text: '2' },
      { key: 'B', text: '4' },
      { key: 'C', text: '5' },
    ],
    score: 10,
    sortOrder: 2,
    answer: ['A', 'B'],
    analysis: '2 和 4',
  },
];

// 未来时间：模拟未到截止时间
const future = () => new Date(Date.now() + 10 * 60_000);
// 过去时间：模拟已过截止时间
const past = () => new Date(Date.now() - 60_000);

// 考试行构造：默认已发布、总分 15、及格 10
function examRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: '期中测验',
    description: '',
    durationMin: 30,
    passScore: 10,
    totalScore: 15,
    status: 'published',
    snapshot: fullSnapshot,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// 考试记录行构造：默认未交卷
function attemptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    examId: 1,
    userId: 1,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    deadlineAt: future(),
    submittedAt: null,
    score: null,
    answers: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// 构建被测服务及 Prisma 替身
function setup() {
  // 数据库替身：考试表 + 考试记录表
  const prisma = {
    exam: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    examAttempt: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  // 被测服务
  const service = new ExamUserService(prisma as unknown as PrismaService);
  return { prisma, service };
}

describe('ExamUserService.startAttempt', () => {
  it('返回快照剥离 answer/analysis；deadline=服务端 now+durationMin', async () => {
    const { prisma, service } = setup();
    prisma.exam.findUnique.mockResolvedValue(examRow());
    prisma.examAttempt.findUnique.mockResolvedValue(null);
    prisma.examAttempt.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 11, ...data }),
    );

    const data = await service.startAttempt(1, 1);

    expect(data.questions).toHaveLength(2);
    expect(
      data.questions.every(
        (question) => !('answer' in question) && !('analysis' in question),
      ),
    ).toBe(true);
    expect(data.deadlineAt.getTime() - Date.now()).toBeCloseTo(30 * 60_000, -3);
    expect(prisma.examAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ examId: 1, userId: 1 }),
    });
  });

  it('已考过（唯一记录存在）幂等返回首次结果', async () => {
    const { prisma, service } = setup();
    prisma.exam.findUnique.mockResolvedValue(examRow());
    const existingDeadline = future();
    prisma.examAttempt.findUnique.mockResolvedValue(
      attemptRow({ deadlineAt: existingDeadline }),
    );

    await expect(service.startAttempt(1, 1)).resolves.toMatchObject({
      attemptId: 11,
      deadlineAt: existingDeadline,
    });
    expect(prisma.examAttempt.create).not.toHaveBeenCalled();
  });

  it('并发唯一冲突时重查并返回首次记录', async () => {
    const { prisma, service } = setup();
    prisma.exam.findUnique.mockResolvedValue(examRow());
    prisma.examAttempt.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(attemptRow());
    prisma.examAttempt.create.mockRejectedValue({ code: 'P2002' });

    await expect(service.startAttempt(1, 1)).resolves.toMatchObject({
      attemptId: 11,
    });
  });

  it('未发布/已结束不可开始（422）', async () => {
    const { prisma, service } = setup();
    prisma.exam.findUnique.mockResolvedValue(examRow({ status: 'ended' }));

    await expect(service.startAttempt(1, 1)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
    expect(prisma.examAttempt.create).not.toHaveBeenCalled();
  });
});

describe('ExamUserService.submitAttempt', () => {
  it('服务端判分落 score/submittedAt，返回总分与及格状态', async () => {
    const { prisma, service } = setup();
    prisma.examAttempt.findUnique.mockResolvedValue(attemptRow());
    prisma.exam.findUnique.mockResolvedValue(examRow());
    const submittedAt = new Date();
    prisma.examAttempt.update.mockResolvedValue(
      attemptRow({ score: 5, submittedAt, answers: { '1': ['A'] } }),
    );

    const result = await service.submitAttempt(1, 1, 11, {
      answers: { '1': ['A'] },
    });

    expect(result).toMatchObject({
      score: 5,
      totalScore: 15,
      passScore: 10,
      passed: false,
    });
    expect(prisma.examAttempt.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({
        score: 5,
        submittedAt: expect.any(Date),
        answers: { '1': ['A'] },
      }),
    });
  });

  it('超 deadline 交卷被拒（6002），服务端时间权威', async () => {
    const { prisma, service } = setup();
    prisma.examAttempt.findUnique.mockResolvedValue(
      attemptRow({ deadlineAt: past() }),
    );
    prisma.exam.findUnique.mockResolvedValue(examRow());

    await expect(
      service.submitAttempt(1, 1, 11, { answers: {} }),
    ).rejects.toMatchObject({ bizCode: 6002, status: 422 });
    expect(prisma.examAttempt.update).not.toHaveBeenCalled();
  });

  it('已提交再次交卷幂等返回首次结果', async () => {
    const { prisma, service } = setup();
    const submittedAt = new Date('2026-01-01T01:00:00Z');
    prisma.examAttempt.findUnique.mockResolvedValue(
      attemptRow({ submittedAt, score: 5, answers: { '1': ['A'] } }),
    );
    prisma.exam.findUnique.mockResolvedValue(examRow());

    await expect(
      service.submitAttempt(1, 1, 11, { answers: { '1': ['B'] } }),
    ).resolves.toMatchObject({ attemptId: 11, score: 5, submittedAt });
    expect(prisma.examAttempt.update).not.toHaveBeenCalled();
  });

  it('他人记录返回 403', async () => {
    const { prisma, service } = setup();
    prisma.examAttempt.findUnique.mockResolvedValue(attemptRow({ userId: 2 }));

    await expect(
      service.submitAttempt(1, 1, 11, { answers: {} }),
    ).rejects.toMatchObject({ bizCode: 2002, status: 403 });
  });
});

describe('ExamUserService.getResult', () => {
  it('未交卷返回 422', async () => {
    const { prisma, service } = setup();
    prisma.examAttempt.findUnique.mockResolvedValue(attemptRow());

    await expect(service.getResult(1, 1, 11)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
  });

  it('交卷后返回正确答案与解析', async () => {
    const { prisma, service } = setup();
    prisma.examAttempt.findUnique.mockResolvedValue(
      attemptRow({
        submittedAt: new Date('2026-01-01T01:00:00Z'),
        score: 5,
        answers: { '1': ['A'] },
      }),
    );
    prisma.exam.findUnique.mockResolvedValue(examRow());

    const result = await service.getResult(1, 1, 11);

    expect(result).toMatchObject({
      score: 5,
      totalScore: 15,
      passScore: 10,
      passed: false,
    });
    expect(result.questions[0]).toMatchObject({
      id: 1,
      userAnswers: ['A'],
      correctAnswers: ['A'],
      analysis: '显然',
    });
    expect(result.questions[1].userAnswers).toEqual([]);
  });
});

describe('ExamUserService.listMine', () => {
  it('返回题目总数；未交卷分数、及格状态与交卷时间为空', async () => {
    const { prisma, service } = setup();
    prisma.examAttempt.findMany.mockResolvedValue([
      { ...attemptRow(), exam: examRow() },
    ]);
    prisma.examAttempt.count.mockResolvedValue(1);

    const page = await service.listMine(1, { page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      attemptId: 11,
      examTitle: '期中测验',
      questionCount: 2,
      score: null,
      totalScore: 15,
      passScore: 10,
      passed: null,
      submittedAt: null,
    });
    expect(prisma.examAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1 }, skip: 0, take: 20 }),
    );
  });

  it('已交卷返回得分与及格状态', async () => {
    const { prisma, service } = setup();
    const submittedAt = new Date('2026-01-01T01:00:00Z');
    prisma.examAttempt.findMany.mockResolvedValue([
      { ...attemptRow({ submittedAt, score: 15 }), exam: examRow() },
    ]);
    prisma.examAttempt.count.mockResolvedValue(1);

    const page = await service.listMine(1, {});

    expect(page.items[0]).toMatchObject({
      score: 15,
      passed: true,
      submittedAt,
    });
  });
});

describe('ExamUserService.autoSubmitExpired', () => {
  it('超时未交卷按空答案判分并返回处理数', async () => {
    const { prisma, service } = setup();
    const now = new Date();
    prisma.examAttempt.findMany.mockResolvedValue([
      { ...attemptRow({ deadlineAt: past() }), exam: examRow() },
    ]);
    prisma.examAttempt.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.autoSubmitExpired(now)).resolves.toBe(1);

    expect(prisma.examAttempt.findMany).toHaveBeenCalledWith({
      where: { submittedAt: null, deadlineAt: { lt: now } },
      include: { exam: true },
    });
    expect(prisma.examAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: 11, submittedAt: null },
      data: { score: 0, submittedAt: now },
    });
  });

  it('已被并发交卷时跳过（幂等）', async () => {
    const { prisma, service } = setup();
    prisma.examAttempt.findMany.mockResolvedValue([
      { ...attemptRow({ deadlineAt: past() }), exam: examRow() },
    ]);
    prisma.examAttempt.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.autoSubmitExpired(new Date())).resolves.toBe(0);
  });
});
