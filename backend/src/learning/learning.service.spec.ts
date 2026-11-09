import { CourseService } from '../catalog/course.service';
import { PrismaService } from '../prisma/prisma.service';
import { LearningService } from './learning.service';

// 构建被测服务及 Prisma/课程服务替身
function setup() {
  const prisma = {
    chapter: { count: jest.fn(), findFirst: jest.fn(), groupBy: jest.fn() },
    learningRecord: {
      upsert: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    course: { findMany: jest.fn() },
  };
  const courseService = { hasPaidAccess: jest.fn().mockResolvedValue(true) };
  const service = new LearningService(
    prisma as unknown as PrismaService,
    courseService as unknown as CourseService,
  );
  return { prisma, courseService, service };
}

describe('LearningService.recordVisit', () => {
  it('recordVisit 首次访问记录并返回 1/N 进度', async () => {
    const { prisma, service } = setup();
    prisma.chapter.findFirst.mockResolvedValue({ id: 1 });
    prisma.chapter.count.mockResolvedValue(2);
    prisma.learningRecord.upsert.mockResolvedValue({});
    prisma.learningRecord.count.mockResolvedValue(1);

    await expect(service.recordVisit(1, 1, 1)).resolves.toEqual({
      progressPercent: 50,
      completed: false,
    });
    expect(prisma.chapter.findFirst).toHaveBeenCalledWith({
      where: { id: 1, courseId: 1 },
      select: { id: true },
    });
    expect(prisma.learningRecord.upsert).toHaveBeenCalledWith({
      where: { userId_chapterId: { userId: 1, chapterId: 1 } },
      create: { userId: 1, courseId: 1, chapterId: 1 },
      update: { visitedAt: expect.any(Date) },
    });
  });

  it('全部章节访问后 completed=true', async () => {
    const { prisma, service } = setup();
    prisma.chapter.findFirst.mockResolvedValue({ id: 2 });
    prisma.chapter.count.mockResolvedValue(2);
    prisma.learningRecord.upsert.mockResolvedValue({});
    prisma.learningRecord.count.mockResolvedValue(2);

    await expect(service.recordVisit(1, 1, 2)).resolves.toEqual({
      progressPercent: 100,
      completed: true,
    });
  });

  it('未购访问抛 3002/403', async () => {
    const { prisma, courseService, service } = setup();
    courseService.hasPaidAccess.mockResolvedValue(false);

    await expect(service.recordVisit(1, 1, 1)).rejects.toMatchObject({
      bizCode: 3002,
      status: 403,
    });
    expect(prisma.learningRecord.upsert).not.toHaveBeenCalled();
  });

  it('章节不属于该课程抛 3001/404', async () => {
    const { prisma, service } = setup();
    prisma.chapter.findFirst.mockResolvedValue(null);

    await expect(service.recordVisit(1, 1, 99)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
    expect(prisma.learningRecord.upsert).not.toHaveBeenCalled();
  });
});

describe('LearningService.getStudyRecords', () => {
  it('getStudyRecords 返回课程、最近章节、进度、最后学习时间', async () => {
    const { prisma, service } = setup();
    const visitedAt = new Date('2026-11-08T10:00:00Z');
    prisma.learningRecord.groupBy.mockResolvedValue([
      { courseId: 1, _max: { visitedAt }, _count: { _all: 2 } },
    ]);
    prisma.course.findMany.mockResolvedValue([
      { id: 1, name: 'TypeScript 系统入门' },
    ]);
    prisma.chapter.groupBy.mockResolvedValue([
      { courseId: 1, _count: { _all: 2 } },
    ]);
    prisma.learningRecord.findMany.mockResolvedValue([
      {
        courseId: 1,
        chapterId: 2,
        visitedAt,
        chapter: { title: '第二章 泛型进阶' },
      },
    ]);

    await expect(
      service.getStudyRecords(1, { page: 1, pageSize: 20 }),
    ).resolves.toEqual({
      items: [
        {
          courseId: 1,
          courseName: 'TypeScript 系统入门',
          chapterCount: 2,
          visitedCount: 2,
          lastChapterId: 2,
          lastChapterTitle: '第二章 泛型进阶',
          progressPercent: 100,
          completed: true,
          lastVisitedAt: visitedAt,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('无学习记录返回空分页', async () => {
    const { prisma, service } = setup();
    prisma.learningRecord.groupBy.mockResolvedValue([]);

    await expect(
      service.getStudyRecords(1, { page: 1, pageSize: 20 }),
    ).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });
});
