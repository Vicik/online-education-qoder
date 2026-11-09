import { PrismaService } from '../prisma/prisma.service';
import { FavoriteService } from './favorite.service';

// 课程简要信息测试数据
const courseRow = {
  id: 1,
  name: 'TypeScript 系统入门',
  type: 'video',
  coverUrl: null,
  instructor: '张老师',
  originalCents: 19900,
  saleCents: 9900,
  status: 'published',
};

// 构建被测服务及 Prisma 替身
function setup() {
  const prisma = {
    course: { findUnique: jest.fn() },
    favorite: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
  const service = new FavoriteService(prisma as unknown as PrismaService);
  return { prisma, service };
}

describe('FavoriteService.add', () => {
  it('add 幂等（复合主键 upsert），重复收藏不报错', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1 });
    prisma.favorite.upsert.mockResolvedValue({});

    await expect(service.add(1, 1)).resolves.toBeUndefined();
    await expect(service.add(1, 1)).resolves.toBeUndefined();

    expect(prisma.favorite.upsert).toHaveBeenCalledWith({
      where: { userId_courseId: { userId: 1, courseId: 1 } },
      create: { userId: 1, courseId: 1 },
      update: {},
    });
    expect(prisma.favorite.upsert).toHaveBeenCalledTimes(2);
  });

  it('收藏不存在的课程抛 3001/404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(null);

    await expect(service.add(1, 99)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
    expect(prisma.favorite.upsert).not.toHaveBeenCalled();
  });
});

describe('FavoriteService.remove', () => {
  it('remove 幂等，重复取消不报错', async () => {
    const { prisma, service } = setup();
    prisma.favorite.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove(1, 1)).resolves.toBeUndefined();
    await expect(service.remove(1, 1)).resolves.toBeUndefined();

    expect(prisma.favorite.deleteMany).toHaveBeenCalledWith({
      where: { userId: 1, courseId: 1 },
    });
    expect(prisma.favorite.deleteMany).toHaveBeenCalledTimes(2);
  });
});

describe('FavoriteService.list', () => {
  it('list 返回已收藏课程分页', async () => {
    const { prisma, service } = setup();
    prisma.favorite.findMany.mockResolvedValue([{ course: courseRow }]);
    prisma.favorite.count.mockResolvedValue(1);

    await expect(service.list(1, { page: 1, pageSize: 20 })).resolves.toEqual({
      items: [courseRow],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(prisma.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 1 },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('无收藏返回空分页', async () => {
    const { prisma, service } = setup();
    prisma.favorite.findMany.mockResolvedValue([]);
    prisma.favorite.count.mockResolvedValue(0);

    await expect(service.list(1, { page: 2, pageSize: 10 })).resolves.toEqual({
      items: [],
      total: 0,
      page: 2,
      pageSize: 10,
    });
  });
});
