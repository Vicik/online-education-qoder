import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

// 构建带假 Prisma 的用户服务；存储替身模拟 key 签名与 http 原样
function setup() {
  // Prisma 替身：覆盖资料与概览所需的模型
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    order: { findMany: jest.fn() },
    learningRecord: { findMany: jest.fn() },
    chapter: { groupBy: jest.fn() },
    favorite: { count: jest.fn() },
    couponClaim: { count: jest.fn() },
    post: { count: jest.fn() },
  };
  const storage = {
    resolveUrl: jest.fn(async (value: string | null) =>
      value === null
        ? null
        : /^https?:/i.test(value)
          ? value
          : `https://signed/${value}`,
    ),
  };
  // 被测服务
  const service = new UsersService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
  );
  return { prisma, storage, service };
}

describe('UsersService', () => {
  describe('getProfile', () => {
    it('返回只读邮箱与资料字段，头像读取时签名', async () => {
      const { prisma, service } = setup();
      // 数据库返回的资料（avatarUrl 存对象存储 key）
      const profile = {
        id: 1,
        email: 'user@example.com',
        nickname: '小知',
        avatarUrl: 'zhixu/avatars/u1.png',
        gender: 'secret',
      };
      prisma.user.findUnique.mockResolvedValue(profile);

      await expect(service.getProfile(1)).resolves.toEqual({
        ...profile,
        avatarKey: 'zhixu/avatars/u1.png',
        avatarUrl: 'https://signed/zhixu/avatars/u1.png',
      });
      // select 不含密码哈希
      const args = prisma.user.findUnique.mock.calls[0][0] as {
        select: Record<string, boolean>;
      };
      expect(args.select).toMatchObject({
        id: true,
        email: true,
        nickname: true,
      });
      expect(args.select.passwordHash).toBeUndefined();
    });

    it('历史 http 头像原样返回且 avatarKey 为 null', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        nickname: '小知',
        avatarUrl: 'https://cdn.example.com/a.png',
        gender: 'secret',
      });

      await expect(service.getProfile(1)).resolves.toMatchObject({
        avatarKey: null,
        avatarUrl: 'https://cdn.example.com/a.png',
      });
    });

    it('用户不存在时抛 2001', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile(99)).rejects.toMatchObject({
        bizCode: 2001,
      });
    });
  });

  describe('updateProfile', () => {
    it('更新昵称/性别/头像并返回最新资料', async () => {
      const { prisma, service } = setup();
      // 更新后的资料（历史 http 头像原样返回）
      const profile = {
        id: 1,
        email: 'user@example.com',
        nickname: '新昵称',
        avatarUrl: 'https://cdn.example.com/a.png',
        gender: 'male',
      };
      prisma.user.update.mockResolvedValue(profile);

      await expect(
        service.updateProfile(1, {
          nickname: '新昵称',
          avatarUrl: 'https://cdn.example.com/a.png',
          gender: 'male',
        }),
      ).resolves.toEqual({ ...profile, avatarKey: null });

      const args = prisma.user.update.mock.calls[0][0] as {
        where: { id: number };
        data: Record<string, unknown>;
      };
      expect(args.where).toEqual({ id: 1 });
      expect(args.data).toEqual({
        nickname: '新昵称',
        gender: 'male',
        avatarUrl: 'https://cdn.example.com/a.png',
      });
    });

    it('未传头像时不覆盖原头像', async () => {
      const { prisma, service } = setup();
      prisma.user.update.mockResolvedValue({ id: 1 });

      await service.updateProfile(1, { nickname: '小知', gender: 'secret' });

      const args = prisma.user.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(args.data).not.toHaveProperty('avatarUrl');
    });

    it('显式传 null 可清空头像', async () => {
      const { prisma, service } = setup();
      prisma.user.update.mockResolvedValue({ id: 1 });

      await service.updateProfile(1, {
        nickname: '小知',
        gender: 'secret',
        avatarUrl: null,
      });

      const args = prisma.user.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(args.data.avatarUrl).toBeNull();
    });
  });

  describe('getOverview', () => {
    it('统计已购/已学完/收藏/未用券/发帖数', async () => {
      const { prisma, service } = setup();
      // 已支付订单：两门不同课程（去重）
      prisma.order.findMany.mockResolvedValue([
        { courseId: 1 },
        { courseId: 2 },
      ]);
      // 学习记录：课程 1 覆盖 2 章，课程 2 仅 1 章
      prisma.learningRecord.findMany.mockResolvedValue([
        { courseId: 1, chapterId: 1 },
        { courseId: 1, chapterId: 2 },
        { courseId: 2, chapterId: 3 },
      ]);
      // 各课程章节总数：课程 1 共 2 章（已学完），课程 2 共 3 章（未学完）
      prisma.chapter.groupBy.mockResolvedValue([
        { courseId: 1, _count: { _all: 2 } },
        { courseId: 2, _count: { _all: 3 } },
      ]);
      prisma.favorite.count.mockResolvedValue(4);
      prisma.couponClaim.count.mockResolvedValue(2);
      prisma.post.count.mockResolvedValue(3);

      await expect(service.getOverview(1)).resolves.toEqual({
        enrolledCount: 2,
        completedCount: 1,
        favoriteCount: 4,
        couponCount: 2,
        postCount: 3,
      });

      // 已购课程按 courseId 去重、仅统计已支付订单
      const orderArgs = prisma.order.findMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
        distinct: string[];
      };
      expect(orderArgs.where).toEqual({ userId: 1, status: 'paid' });
      expect(orderArgs.distinct).toEqual(['courseId']);
      // 未用券按状态过滤
      expect(prisma.couponClaim.count).toHaveBeenCalledWith({
        where: { userId: 1, status: 'unused' },
      });
    });

    it('没有学习记录时已学完为 0 且不查章节数', async () => {
      const { prisma, service } = setup();
      prisma.order.findMany.mockResolvedValue([]);
      prisma.learningRecord.findMany.mockResolvedValue([]);
      prisma.favorite.count.mockResolvedValue(0);
      prisma.couponClaim.count.mockResolvedValue(0);
      prisma.post.count.mockResolvedValue(0);

      const result = await service.getOverview(1);

      expect(result.completedCount).toBe(0);
      expect(prisma.chapter.groupBy).not.toHaveBeenCalled();
    });
  });
});
