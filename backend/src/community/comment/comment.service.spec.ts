import { BizException } from '../../common/exceptions/biz.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { BlockedWordService } from '../blocked-word/blocked-word.service';
import { CommentService } from './comment.service';

// 评论创建时间（固定值，便于断言）
const CREATED_AT = new Date('2026-11-09T11:00:00Z');

// 构建被测服务及 Prisma/屏蔽词/幂等替身
function setup() {
  // Prisma 替身：帖子存在性、评论读写与用户昵称
  const prisma = {
    post: { findUnique: jest.fn() }, // 帖子存在性
    comment: {
      findUnique: jest.fn(), // 父评论校验 / 归属校验
      create: jest.fn(), // 一级评论 / 回复
      delete: jest.fn(), // 删除评论
    },
    user: { findUnique: jest.fn() }, // 回复目标昵称
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
  // 存储替身：富文本图片重写 src
  const storage = {
    signRichHtml: jest.fn(async (html: string) =>
      html.replace(/src="(zhixu\/[^"]+)"/g, 'src="https://signed/$1"'),
    ),
  };
  const service = new CommentService(
    prisma as unknown as PrismaService,
    blockedWords as unknown as BlockedWordService,
    idempotency as unknown as IdempotencyService,
    storage as unknown as StorageService,
  );
  return { prisma, blockedWords, idempotency, storage, service };
}

describe('CommentService.create', () => {
  it('一级评论：挂帖子，净化 + 屏蔽词校验', async () => {
    const { prisma, blockedWords, service } = setup();
    prisma.post.findUnique.mockResolvedValue({ id: 1 });
    prisma.comment.create.mockResolvedValue({
      id: 10,
      userId: 1,
      content: '<p>评论</p>',
      createdAt: CREATED_AT,
      user: { nickname: '甲' },
    });

    await expect(
      service.create(1, 1, { content: '<p onclick="x()">评论</p>' }, 'key-c-1'),
    ).resolves.toMatchObject({
      id: 10,
      nickname: '甲',
      content: '<p>评论</p>',
      replies: [],
    });

    expect(blockedWords.assertAllowed).toHaveBeenCalledWith(
      '<p onclick="x()">评论</p>',
    );
    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: { postId: 1, userId: 1, content: '<p>评论</p>', parentId: null },
      include: { user: { select: { nickname: true } } },
    });
  });

  it('帖子不存在抛 404', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue(null);

    await expect(
      service.create(1, 99, { content: '评论' }, 'key-c-2'),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it('命中屏蔽词抛 7001', async () => {
    const { prisma, blockedWords, service } = setup();
    prisma.post.findUnique.mockResolvedValue({ id: 1 });
    blockedWords.assertAllowed.mockRejectedValue(
      new BizException(7001, '内容包含敏感词', 422, ['广告']),
    );

    await expect(
      service.create(1, 1, { content: '广告' }, 'key-c-3'),
    ).rejects.toMatchObject({ bizCode: 7001, details: ['广告'] });
  });

  it('评论图片读取时重写为签名地址', async () => {
    const { prisma, service } = setup();
    prisma.post.findUnique.mockResolvedValue({ id: 1 });
    prisma.comment.create.mockResolvedValue({
      id: 12,
      userId: 1,
      content:
        '<p>评论</p><img src="zhixu/comments/c1.png" data-key="zhixu/comments/c1.png" />',
      createdAt: CREATED_AT,
      user: { nickname: '甲' },
    });

    const view = await service.create(1, 1, { content: '评论' }, 'key-c-4');

    expect(view.content).toContain(
      'src="https://signed/zhixu/comments/c1.png"',
    );
    expect(view.content).toContain('data-key="zhixu/comments/c1.png"');
  });
});

describe('CommentService.reply', () => {
  it('回复必须挂一级评论；挂在回复下抛 1001', async () => {
    const { prisma, service } = setup();
    // 父评论是一级评论
    prisma.comment.findUnique.mockResolvedValueOnce({
      id: 5,
      parentId: null,
      postId: 1,
    });
    prisma.comment.create.mockResolvedValue({
      id: 11,
      userId: 1,
      content: 'r',
      createdAt: CREATED_AT,
      replyToUserId: null,
      user: { nickname: '乙' },
    });

    await expect(
      service.reply(1, 5, { content: 'r', replyToUserId: null }, 'key-r-1'),
    ).resolves.toMatchObject({ id: 11, nickname: '乙', replyToNickname: null });

    // 父评论本身是回复（已存在两层，禁止第三层）
    prisma.comment.findUnique.mockResolvedValueOnce({
      id: 6,
      parentId: 5,
      postId: 1,
    });
    await expect(
      service.reply(1, 6, { content: 'r', replyToUserId: null }, 'key-r-2'),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('回复落库时 parentId 指向一级评论 id', async () => {
    const { prisma, service } = setup();
    prisma.comment.findUnique.mockResolvedValueOnce({
      id: 5,
      parentId: null,
      postId: 1,
    });
    prisma.comment.create.mockResolvedValue({
      id: 11,
      userId: 3,
      content: '回复你',
      createdAt: CREATED_AT,
      replyToUserId: 1,
      user: { nickname: '乙' },
    });
    prisma.user.findUnique.mockResolvedValue({ nickname: '甲' });

    await expect(
      service.reply(3, 5, { content: '回复你', replyToUserId: 1 }, 'key-r-3'),
    ).resolves.toMatchObject({ replyToNickname: '甲' });

    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: {
        postId: 1,
        userId: 3,
        content: '回复你',
        parentId: 5,
        replyToUserId: 1,
      },
      include: { user: { select: { nickname: true } } },
    });
  });

  it('回复图片读取时重写为签名地址', async () => {
    const { prisma, service } = setup();
    prisma.comment.findUnique.mockResolvedValueOnce({
      id: 5,
      parentId: null,
      postId: 1,
    });
    prisma.comment.create.mockResolvedValue({
      id: 13,
      userId: 3,
      content:
        '<img src="zhixu/comments/r1.png" data-key="zhixu/comments/r1.png" />',
      createdAt: CREATED_AT,
      replyToUserId: null,
      user: { nickname: '乙' },
    });

    const reply = await service.reply(
      3,
      5,
      { content: '回复', replyToUserId: null },
      'key-r-4',
    );

    expect(reply.content).toContain(
      'src="https://signed/zhixu/comments/r1.png"',
    );
  });
});

describe('CommentService.remove', () => {
  it('删除一级评论（回复由 DB 级联）', async () => {
    const { prisma, service } = setup();
    prisma.comment.findUnique.mockResolvedValue({
      id: 5,
      parentId: null,
      userId: 1,
    });
    prisma.comment.delete.mockResolvedValue({});

    await service.remove(1, 5);

    expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  it('删除单条回复不影响兄弟', async () => {
    const { prisma, service } = setup();
    prisma.comment.findUnique.mockResolvedValue({
      id: 7,
      parentId: 5,
      userId: 1,
    });
    prisma.comment.delete.mockResolvedValue({});

    await service.remove(1, 7);

    expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });

  it('只能删除自己的评论（403）', async () => {
    const { prisma, service } = setup();
    prisma.comment.findUnique.mockResolvedValue({
      id: 5,
      parentId: null,
      userId: 2,
    });

    await expect(service.remove(1, 5)).rejects.toMatchObject({
      bizCode: 2002,
      status: 403,
    });
    expect(prisma.comment.delete).not.toHaveBeenCalled();
  });

  it('评论不存在抛 404', async () => {
    const { prisma, service } = setup();
    prisma.comment.findUnique.mockResolvedValue(null);

    await expect(service.remove(1, 99)).rejects.toMatchObject({ status: 404 });
  });
});
