import { BizException } from '../../common/exceptions/biz.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { BlockedWordService } from '../blocked-word/blocked-word.service';
import { PostService } from './post.service';

// 帖子创建时间（固定值，便于断言）
const CREATED_AT = new Date('2026-11-09T10:00:00Z');

// 构建被测服务及 Prisma/屏蔽词/幂等替身
function setup() {
  // Prisma 替身：帖子、点赞、用户查询与事务
  const prisma = {
    post: {
      findMany: jest.fn(), // 信息流 / 我的帖子
      count: jest.fn(), // 列表总数
      findUnique: jest.fn(), // 详情 / 归属校验
      create: jest.fn(), // 发帖
      delete: jest.fn(), // 删帖
      update: jest.fn(), // 点赞计数
    },
    postLike: {
      findMany: jest.fn(), // likedByMe 批量查询
      findUnique: jest.fn(), // 详情 likedByMe / 重复点赞判定
      upsert: jest.fn(), // 点赞幂等写入
      deleteMany: jest.fn(), // 取消点赞幂等删除
    },
    comment: { findMany: jest.fn() }, // 详情两级评论
    user: { findMany: jest.fn() }, // 回复目标昵称
    $transaction: jest.fn(), // 点赞事务
  };
  // 屏蔽词替身：默认放行
  const blockedWords = {
    assertAllowed: jest.fn().mockResolvedValue(undefined),
  };
  // 幂等替身：直接执行首次逻辑
  const idempotency = {
    run: jest.fn(
      (
        _userId: number,
        _key: string,
        _endpoint: string,
        fn: () => Promise<unknown>,
      ) => fn(),
    ),
  };
  // 存储替身：头像 key 签名、http 原样，富文本图片重写 src
  const storage = {
    resolveUrl: jest.fn(async (value: string | null) =>
      value === null
        ? null
        : /^https?:/i.test(value)
          ? value
          : `https://signed/${value}`,
    ),
    signRichHtml: jest.fn(async (html: string) =>
      html.replace(/src="(zhixu\/[^"]+)"/g, 'src="https://signed/$1"'),
    ),
  };
  const service = new PostService(
    prisma as unknown as PrismaService,
    blockedWords as unknown as BlockedWordService,
    idempotency as unknown as IdempotencyService,
    storage as unknown as StorageService,
  );
  return { prisma, blockedWords, idempotency, storage, service };
}

// 信息流行：含作者与评论计数（头像存 key，内容含待签名图片）
const FEED_ROW = {
  id: 1,
  userId: 1,
  content:
    '<p>c</p><img data-key="zhixu/posts/p1.png" src="zhixu/posts/p1.png" />',
  likeCount: 2,
  createdAt: CREATED_AT,
  user: { nickname: 'n', avatarUrl: 'zhixu/avatars/u1.png' },
  _count: { comments: 0 },
};

describe('PostService.create', () => {
  it('净化 HTML、校验屏蔽词并走幂等', async () => {
    const { prisma, blockedWords, idempotency, service } = setup();
    prisma.post.create.mockResolvedValue({
      id: 5,
      userId: 1,
      content: '<p>你好</p>',
      likeCount: 0,
      createdAt: CREATED_AT,
      user: { nickname: 'n', avatarUrl: null },
    });

    await expect(
      service.create(1, { content: '<p onclick="x()">你好</p>' }, 'key-p-1'),
    ).resolves.toMatchObject({ id: 5, content: '<p>你好</p>', likeCount: 0 });

    // 屏蔽词对原始内容校验；落库内容为净化结果
    expect(blockedWords.assertAllowed).toHaveBeenCalledWith(
      '<p onclick="x()">你好</p>',
    );
    expect(prisma.post.create).toHaveBeenCalledWith({
      data: { userId: 1, content: '<p>你好</p>' },
      include: { user: { select: { nickname: true, avatarUrl: true } } },
    });
    expect(idempotency.run).toHaveBeenCalledWith(
      1,
      'key-p-1',
      'POST /posts',
      expect.any(Function),
    );
  });

  it('命中屏蔽词抛 7001 且不落库', async () => {
    const { prisma, blockedWords, service } = setup();
    blockedWords.assertAllowed.mockRejectedValue(
      new BizException(7001, '内容包含敏感词', 422, ['广告']),
    );

    await expect(
      service.create(1, { content: '广告' }, 'key-p-2'),
    ).rejects.toMatchObject({ bizCode: 7001, details: ['广告'] });
    expect(prisma.post.create).not.toHaveBeenCalled();
  });
});

describe('PostService.list', () => {
  it('组装 likedByMe 与 commentCount；登录用户返回 likedByMe', async () => {
    const { prisma, service } = setup();
    prisma.post.findMany.mockResolvedValue([FEED_ROW]);
    prisma.post.count.mockResolvedValue(1);
    prisma.postLike.findMany.mockResolvedValue([{ postId: 1 }]);

    const page = await service.list({ page: 1, pageSize: 20 }, 2);

    expect(page.items[0]).toMatchObject({
      id: 1,
      nickname: 'n',
      avatarKey: 'zhixu/avatars/u1.png',
      avatarUrl: 'https://signed/zhixu/avatars/u1.png',
      likeCount: 2,
      commentCount: 0,
      likedByMe: true,
    });
    expect(page.items[0].content).toContain(
      'src="https://signed/zhixu/posts/p1.png"',
    );
    expect(page.items[0].content).toContain('data-key="zhixu/posts/p1.png"');
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(prisma.postLike.findMany).toHaveBeenCalledWith({
      where: { userId: 2, postId: { in: [1] } },
      select: { postId: true },
    });
  });

  it('游客不返回 likedByMe，也不查点赞表', async () => {
    const { prisma, service } = setup();
    prisma.post.findMany.mockResolvedValue([FEED_ROW]);
    prisma.post.count.mockResolvedValue(1);

    const page = await service.list({ page: 1, pageSize: 20 });

    expect(page.items[0]).not.toHaveProperty('likedByMe');
    expect(prisma.postLike.findMany).not.toHaveBeenCalled();
  });
});

describe('PostService.getDetail', () => {
  it('返回两层评论树与回复目标昵称', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue({
      ...FEED_ROW,
      _count: { comments: 2 },
    });
    prisma.postLike.findUnique.mockResolvedValue({ postId: 1, userId: 2 });
    prisma.comment.findMany.mockResolvedValue([
      {
        id: 10,
        userId: 1,
        content:
          '<p>一级评论</p><img src="zhixu/comments/c1.png" data-key="zhixu/comments/c1.png" />',
        createdAt: CREATED_AT,
        user: { nickname: '甲' },
        replies: [
          {
            id: 11,
            userId: 3,
            content:
              '<p>回复你</p><img src="zhixu/comments/r1.png" data-key="zhixu/comments/r1.png" />',
            createdAt: CREATED_AT,
            replyToUserId: 1,
            user: { nickname: '乙' },
          },
        ],
      },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: 1, nickname: '甲' }]);

    const detail = await service.getDetail(1, 2);

    expect(detail).toMatchObject({ id: 1, likedByMe: true, commentCount: 2 });
    expect(detail.comments).toHaveLength(1);
    expect(detail.comments[0]).toMatchObject({ id: 10, nickname: '甲' });
    expect(detail.comments[0].content).toContain(
      'src="https://signed/zhixu/comments/c1.png"',
    );
    expect(detail.comments[0].replies[0]).toMatchObject({
      id: 11,
      nickname: '乙',
      replyToNickname: '甲',
    });
    expect(detail.comments[0].replies[0].content).toContain(
      'src="https://signed/zhixu/comments/r1.png"',
    );
  });

  it('作者头像为历史 http 时原样返回且 avatarKey 为 null', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue({
      ...FEED_ROW,
      user: { nickname: 'n', avatarUrl: 'https://cdn.test/a.png' },
      _count: { comments: 0 },
    });
    prisma.comment.findMany.mockResolvedValue([]);

    const detail = await service.getDetail(1);

    expect(detail).toMatchObject({
      avatarKey: null,
      avatarUrl: 'https://cdn.test/a.png',
    });
  });

  it('帖子不存在抛 404', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue(null);

    await expect(service.getDetail(99)).rejects.toMatchObject({ status: 404 });
  });
});

describe('PostService.remove', () => {
  it('仅本人可删；他人 403', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue({ id: 1, userId: 2 });

    await expect(service.remove(1, 1)).rejects.toMatchObject({
      bizCode: 2002,
      status: 403,
    });
    expect(prisma.post.delete).not.toHaveBeenCalled();
  });

  it('本人删除帖子（评论由 DB 级联）', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue({ id: 1, userId: 1 });
    prisma.post.delete.mockResolvedValue({});

    await service.remove(1, 1);

    expect(prisma.post.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it('帖子不存在抛 404', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue(null);

    await expect(service.remove(1, 99)).rejects.toMatchObject({ status: 404 });
  });
});

describe('PostService.like/unlike', () => {
  it('点赞幂等：复合主键 upsert + 原子 +1', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue({ id: 1 });
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    prisma.postLike.findUnique.mockResolvedValue(null);
    prisma.postLike.upsert.mockResolvedValue({});
    prisma.post.update.mockResolvedValue({});

    await service.like(1, 1);

    expect(prisma.postLike.upsert).toHaveBeenCalledWith({
      where: { postId_userId: { postId: 1, userId: 1 } },
      create: { postId: 1, userId: 1 },
      update: {},
    });
    expect(prisma.post.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { likeCount: { increment: 1 } },
    });
  });

  it('重复点赞不再增加计数', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue({ id: 1 });
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    prisma.postLike.findUnique.mockResolvedValue({ postId: 1, userId: 1 });
    prisma.postLike.upsert.mockResolvedValue({});

    await service.like(1, 1);

    expect(prisma.post.update).not.toHaveBeenCalled();
  });

  it('取消点赞仅在确实删除时 -1', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue({ id: 1 });
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    prisma.postLike.deleteMany.mockResolvedValue({ count: 1 });
    prisma.post.update.mockResolvedValue({});

    await service.unlike(1, 1);

    expect(prisma.postLike.deleteMany).toHaveBeenCalledWith({
      where: { postId: 1, userId: 1 },
    });
    expect(prisma.post.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { likeCount: { decrement: 1 } },
    });
  });

  it('未点赞时取消不减少计数', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue({ id: 1 });
    prisma.$transaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) => fn(prisma),
    );
    prisma.postLike.deleteMany.mockResolvedValue({ count: 0 });

    await service.unlike(1, 1);

    expect(prisma.post.update).not.toHaveBeenCalled();
  });

  it('帖子不存在点赞抛 404', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue(null);

    await expect(service.like(1, 99)).rejects.toMatchObject({ status: 404 });
  });
});

describe('PostService.listMine', () => {
  it('仅查自己的帖子并组装 brief', async () => {
    const { prisma, service } = setup();
    prisma.post.findMany.mockResolvedValue([FEED_ROW]);
    prisma.post.count.mockResolvedValue(1);
    prisma.postLike.findMany.mockResolvedValue([]);

    const page = await service.listMine(1, { page: 1, pageSize: 20 });

    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1 } }),
    );
    expect(page.items[0]).toMatchObject({ id: 1, likedByMe: false });
  });
});
