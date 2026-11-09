import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChapterAdminService } from './chapter.admin.service';

// 管理端写操作上下文（模拟已登录管理员）
const CTX = { actorId: 9, ip: '127.0.0.1', requestId: 'req-1' };

// 构建被测服务及 Prisma/审计替身
function setup() {
  const prisma = {
    course: { findUnique: jest.fn() },
    chapter: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new ChapterAdminService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { prisma, audit, service };
}

// 草稿视频课程
const VIDEO_DRAFT = { id: 1, type: 'video', status: 'draft' };
// 已发布视频课程
const VIDEO_PUBLISHED = { ...VIDEO_DRAFT, status: 'published' };
// 草稿图文章节
const RICH_DRAFT = { id: 1, type: 'rich', status: 'draft' };

describe('ChapterAdminService.addChapter', () => {
  it('章节类型必须与课程类型一致', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_DRAFT);

    await expect(
      service.addChapter(1, { title: 'x', contentType: 'rich', content: 'y' }),
    ).rejects.toMatchObject({ bizCode: 1001 });
    expect(prisma.chapter.create).not.toHaveBeenCalled();
  });

  it('已发布课程不可增删章节（先下架）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_PUBLISHED);

    await expect(
      service.addChapter(1, {
        title: 'x',
        contentType: 'video',
        content: 'y',
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('下架'),
    });
  });

  it('标题超过 60 字符返回 1001', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_DRAFT);

    await expect(
      service.addChapter(1, {
        title: 'x'.repeat(61),
        contentType: 'video',
        content: 'y',
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('新章节 sortOrder = max+1，富文本内容净化后落库', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(RICH_DRAFT);
    prisma.chapter.aggregate.mockResolvedValue({ _max: { sortOrder: 2 } });
    prisma.chapter.create.mockImplementation(({ data }) =>
      Promise.resolve(data),
    );

    const created = await service.addChapter(1, {
      title: '第一节',
      contentType: 'rich',
      content: '<p onclick="x()">a</p>',
    });

    expect(prisma.chapter.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        courseId: 1,
        title: '第一节',
        contentType: 'rich',
        content: '<p>a</p>',
        sortOrder: 3,
      }),
    });
    expect(created.sortOrder).toBe(3);
  });

  it('首个章节新增后写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_DRAFT);
    prisma.chapter.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
    prisma.chapter.create.mockResolvedValue({ id: 7, sortOrder: 1 });

    await service.addChapter(
      1,
      { title: '第一节', contentType: 'video', content: 'videos/a.mp4' },
      CTX,
    );

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 9,
        action: 'chapter.create',
        targetType: 'chapter',
        targetId: 7,
      }),
    );
  });
});

describe('ChapterAdminService.updateChapter', () => {
  it('已发布课程禁止编辑章节', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_PUBLISHED);

    await expect(
      service.updateChapter(1, 2, { title: '新标题' }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('下架'),
    });
  });

  it('章节不存在返回 404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_DRAFT);
    prisma.chapter.findFirst.mockResolvedValue(null);

    await expect(
      service.updateChapter(1, 2, { title: '新标题' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('富文本章节内容净化并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findUnique.mockResolvedValue(RICH_DRAFT);
    prisma.chapter.findFirst.mockResolvedValue({ id: 2, title: '旧标题' });
    prisma.chapter.update.mockResolvedValue({ id: 2, title: '新标题' });

    await service.updateChapter(
      1,
      2,
      { content: '<p onclick="x()">a</p>' },
      CTX,
    );

    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { content: '<p>a</p>' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'chapter.update', targetId: 2 }),
    );
  });
});

describe('ChapterAdminService.deleteChapter', () => {
  it('删除后按 1..n 重编号并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_DRAFT);
    prisma.chapter.findFirst.mockResolvedValue({ id: 2, title: '要删除' });
    prisma.chapter.findMany.mockResolvedValue([
      { id: 1, title: '一', contentType: 'video', sortOrder: 1 },
      { id: 3, title: '三', contentType: 'video', sortOrder: 3 },
    ]);
    prisma.chapter.updateMany.mockResolvedValue({ count: 2 });

    await service.deleteChapter(1, 2, CTX);

    expect(prisma.chapter.delete).toHaveBeenCalledWith({ where: { id: 2 } });
    expect(prisma.chapter.updateMany).toHaveBeenCalledWith({
      where: { courseId: 1 },
      data: { sortOrder: { increment: 1000 } },
    });
    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { sortOrder: 1 },
    });
    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { sortOrder: 2 },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'chapter.delete', targetId: 2 }),
    );
  });

  it('已下架课程可删除章节', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({
      ...VIDEO_DRAFT,
      status: 'unpublished',
    });
    prisma.chapter.findFirst.mockResolvedValue({ id: 2 });
    prisma.chapter.findMany.mockResolvedValue([]);
    prisma.chapter.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.deleteChapter(1, 2)).resolves.toBeUndefined();
  });
});

describe('ChapterAdminService.reorderChapters', () => {
  // 现有三章（sortOrder 1..3）
  const CHAPTERS = [
    { id: 1, title: '一', contentType: 'video', sortOrder: 1 },
    { id: 2, title: '二', contentType: 'video', sortOrder: 2 },
    { id: 3, title: '三', contentType: 'video', sortOrder: 3 },
  ];

  it('两阶段重编号，最终 1..n 连续且无唯一冲突', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_DRAFT);
    prisma.chapter.findMany.mockResolvedValue(CHAPTERS);
    prisma.chapter.updateMany.mockResolvedValue({ count: 3 });

    const ids = [3, 1, 2];
    await service.reorderChapters(1, { orderedChapterIds: ids });

    expect(prisma.chapter.updateMany).toHaveBeenNthCalledWith(1, {
      where: { courseId: 1 },
      data: { sortOrder: { increment: 1000 } },
    });
    ids.forEach((id, index) => {
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id },
        data: { sortOrder: index + 1 },
      });
    });
  });

  it('orderedChapterIds 缺项/多项/重复均返回 1001', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_DRAFT);
    prisma.chapter.findMany.mockResolvedValue(CHAPTERS);

    await expect(
      service.reorderChapters(1, { orderedChapterIds: [1, 2] }),
    ).rejects.toMatchObject({ bizCode: 1001 });
    await expect(
      service.reorderChapters(1, { orderedChapterIds: [1, 2, 3, 4] }),
    ).rejects.toMatchObject({ bizCode: 1001 });
    await expect(
      service.reorderChapters(1, { orderedChapterIds: [1, 1, 2] }),
    ).rejects.toMatchObject({ bizCode: 1001 });
    expect(prisma.chapter.updateMany).not.toHaveBeenCalled();
  });

  it('已发布课程不可排序', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_PUBLISHED);

    await expect(
      service.reorderChapters(1, { orderedChapterIds: [3, 2, 1] }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('下架'),
    });
  });

  it('排序后写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_DRAFT);
    prisma.chapter.findMany.mockResolvedValue(CHAPTERS);
    prisma.chapter.updateMany.mockResolvedValue({ count: 3 });

    await service.reorderChapters(1, { orderedChapterIds: [1, 2, 3] }, CTX);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'chapter.reorder',
        targetType: 'course',
      }),
    );
  });
});
