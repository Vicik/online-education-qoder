import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import { PageQuery } from '../../common/dto/page-query.dto';
import { PageResult } from '../../common/dto/page-result';
import { BizException } from '../../common/exceptions/biz.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { isStorageKey } from '../../common/utils/media.util';
import { sanitizeRichHtml } from '../../common/utils/sanitize.util';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { BlockedWordService } from '../blocked-word/blocked-word.service';
import { CreatePostDto } from '../dto/create-post.dto';

// 帖子简要信息：与 openapi PostBrief 一致（游客不含 likedByMe）
export interface PostBrief {
  id: number; // 帖子 id
  userId: number; // 作者 id
  nickname: string; // 作者昵称
  avatarKey: string | null; // 作者头像对象存储 key（历史 http 数据为 null）
  avatarUrl: string | null; // 作者头像展示地址（key 为签名 URL）
  content: string; // 净化后的内容（图片已换签名地址）
  likeCount: number; // 点赞数
  likedByMe?: boolean; // 当前登录用户是否已点赞（仅登录用户返回）
  commentCount: number; // 评论总数（一级 + 回复）
  createdAt: Date; // 发布时间
}

// 回复视图：与 openapi ReplyView 一致
export interface ReplyView {
  id: number; // 回复 id
  userId: number; // 回复人 id
  nickname: string; // 回复人昵称
  replyToNickname: string | null; // 被回复人昵称（未指定时 null）
  content: string; // 回复内容
  createdAt: Date; // 回复时间
}

// 一级评论视图：与 openapi CommentView 一致
export interface CommentView {
  id: number; // 评论 id
  userId: number; // 评论人 id
  nickname: string; // 评论人昵称
  content: string; // 评论内容
  createdAt: Date; // 评论时间
  replies: ReplyView[]; // 该评论下的全部回复
}

// 帖子详情：与 openapi PostDetail 一致
export interface PostDetail extends PostBrief {
  comments: CommentView[]; // 两级评论树
}

// 作者信息：列表/详情联查用户字段
interface AuthorInfo {
  nickname: string; // 昵称
  avatarUrl: string | null; // 头像
}

// 帖子基础行：含作者信息
interface PostBaseRow {
  id: number; // 帖子 id
  userId: number; // 作者 id
  content: string; // 内容
  likeCount: number; // 点赞数
  createdAt: Date; // 发布时间
  user: AuthorInfo; // 作者
}

// 信息流行：额外带评论计数
interface PostFeedRow extends PostBaseRow {
  _count: { comments: number }; // 评论总数
}

// 回复行：含回复人昵称
interface ReplyRow {
  id: number; // 回复 id
  userId: number; // 回复人 id
  content: string; // 回复内容
  createdAt: Date; // 回复时间
  replyToUserId: number | null; // 被回复人 id
  user: { nickname: string }; // 回复人
}

// 一级评论行：含回复列表
interface CommentRow {
  id: number; // 评论 id
  userId: number; // 评论人 id
  content: string; // 评论内容
  createdAt: Date; // 评论时间
  user: { nickname: string }; // 评论人
  replies: ReplyRow[]; // 回复列表
}

// 列表/详情统一的关联查询
const POST_INCLUDE = {
  user: { select: { nickname: true, avatarUrl: true } },
  _count: { select: { comments: true } },
} as const;

// 组装帖子简要信息：头像与正文图片读取时签名；likedByMe 仅在已知登录用户时写入
async function toPostBrief(
  row: PostBaseRow,
  storage: StorageService,
  commentCount: number,
  likedByMe?: boolean,
): Promise<PostBrief> {
  return {
    id: row.id,
    userId: row.userId,
    nickname: row.user.nickname,
    avatarKey: isStorageKey(row.user.avatarUrl) ? row.user.avatarUrl : null,
    avatarUrl: await storage.resolveUrl(row.user.avatarUrl),
    content: await storage.resolveRichHtml(row.content),
    likeCount: row.likeCount,
    ...(likedByMe === undefined ? {} : { likedByMe }),
    commentCount,
    createdAt: row.createdAt,
  };
}

// 帖子服务：信息流、详情、发帖、删帖、点赞与我的帖子
@Injectable()
export class PostService {
  // 构造函数：注入 Prisma、屏蔽词、幂等与存储签名服务
  constructor(
    private readonly prisma: PrismaService,
    private readonly blockedWords: BlockedWordService,
    private readonly idempotency: IdempotencyService,
    private readonly storage: StorageService,
  ) {}

  // 信息流：创建时间倒序分页，登录用户附 likedByMe
  async list(
    page: PageQuery,
    viewerId?: number,
  ): Promise<PageResult<PostBrief>> {
    return this.listByWhere({}, page, viewerId);
  }

  // 我的帖子：仅自己发布的帖子，不含评论与回复
  async listMine(
    userId: number,
    page: PageQuery,
  ): Promise<PageResult<PostBrief>> {
    return this.listByWhere({ userId }, page, userId);
  }

  // 帖子详情：帖子 + 一级评论 + 每条评论的回复（两层）
  async getDetail(postId: number, viewerId?: number): Promise<PostDetail> {
    // 帖子必须存在
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: POST_INCLUDE,
    });
    if (!post) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '帖子不存在', 404);
    }

    // 一级评论及其回复（按时间正序）
    const comments = (await this.prisma.comment.findMany({
      where: { postId, parentId: null },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { nickname: true } },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { nickname: true } } },
        },
      },
    })) as unknown as CommentRow[];

    // 回复目标用户 id 去重（排除未指定目标）
    const replyToIds = [
      ...new Set(
        comments
          .flatMap((comment) =>
            comment.replies.map((reply) => reply.replyToUserId),
          )
          .filter((id): id is number => id !== null),
      ),
    ];
    // 批量查询被回复人昵称（schema 未建立关系，按 id 联查）
    const targetUsers =
      replyToIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: replyToIds } },
            select: { id: true, nickname: true },
          });
    // 用户 id -> 昵称
    const nicknameById = new Map(
      targetUsers.map((user) => [user.id, user.nickname]),
    );

    // 登录用户是否已点赞
    const likedByMe =
      viewerId === undefined
        ? undefined
        : (await this.prisma.postLike.findUnique({
            where: { postId_userId: { postId, userId: viewerId } },
            select: { postId: true },
          })) !== null;

    // 评论与回复的正文图片读取时签名
    const commentViews = await Promise.all(
      comments.map(async (comment) => ({
        id: comment.id,
        userId: comment.userId,
        nickname: comment.user.nickname,
        content: await this.storage.resolveRichHtml(comment.content),
        createdAt: comment.createdAt,
        replies: await Promise.all(
          comment.replies.map(async (reply) => ({
            id: reply.id,
            userId: reply.userId,
            nickname: reply.user.nickname,
            replyToNickname:
              reply.replyToUserId === null
                ? null
                : (nicknameById.get(reply.replyToUserId) ?? null),
            content: await this.storage.resolveRichHtml(reply.content),
            createdAt: reply.createdAt,
          })),
        ),
      })),
    );

    return {
      ...(await toPostBrief(
        post as PostFeedRow,
        this.storage,
        post._count.comments,
        likedByMe,
      )),
      comments: commentViews,
    };
  }

  // 发帖：屏蔽词校验 -> 服务端净化 -> 幂等创建
  async create(
    userId: number,
    dto: CreatePostDto,
    idempotencyKey: string,
  ): Promise<PostBrief> {
    // 屏蔽词对原始内容校验（命中 7001 附词表）
    await this.blockedWords.assertAllowed(dto.content);
    // 富文本按白名单净化后落库
    const content = sanitizeRichHtml(dto.content);

    return this.idempotency.run(
      userId,
      idempotencyKey,
      'POST /posts',
      async () => {
        const created = await this.prisma.post.create({
          data: { userId, content },
          include: { user: { select: { nickname: true, avatarUrl: true } } },
        });
        return toPostBrief(created as PostBaseRow, this.storage, 0, false);
      },
    );
  }

  // 删除自己的帖子：归属校验后删除，评论由 DB 级联清理
  async remove(userId: number, postId: number): Promise<void> {
    // 帖子必须存在
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, userId: true },
    });
    if (!post) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '帖子不存在', 404);
    }
    // 仅作者本人可删（防 IDOR）
    if (post.userId !== userId) {
      throw new BizException(ErrorCode.FORBIDDEN, '无权删除他人的帖子', 403);
    }

    await this.prisma.post.delete({ where: { id: postId } });
  }

  // 点赞：幂等写入点赞记录，首次点赞原子 +1
  async like(userId: number, postId: number): Promise<void> {
    await this.assertPostExists(postId);

    await this.prisma.$transaction(async (tx) => {
      // 已点赞则不再重复计数
      const existing = await tx.postLike.findUnique({
        where: { postId_userId: { postId, userId } },
        select: { postId: true },
      });
      // 复合主键 upsert：并发下不产生重复行
      await tx.postLike.upsert({
        where: { postId_userId: { postId, userId } },
        create: { postId, userId },
        update: {},
      });
      if (!existing) {
        await tx.post.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
        });
      }
    });
  }

  // 取消点赞：幂等删除，确实删除过才原子 -1
  async unlike(userId: number, postId: number): Promise<void> {
    await this.assertPostExists(postId);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.postLike.deleteMany({
        where: { postId, userId },
      });
      // 未点赞时跳过计数，避免负数
      if (count > 0) {
        await tx.post.update({
          where: { id: postId },
          data: { likeCount: { decrement: 1 } },
        });
      }
    });
  }

  // 列表通用实现：按条件分页并批量组装 likedByMe
  private async listByWhere(
    where: Record<string, unknown>,
    page: PageQuery,
    viewerId?: number,
  ): Promise<PageResult<PostBrief>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;

    const [rows, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: POST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.post.count({ where }),
    ]);

    // 当前页帖子 id
    const postIds = rows.map((row) => row.id);
    // 登录用户在当前页点过赞的帖子集合
    const likedIds =
      viewerId === undefined
        ? undefined
        : new Set(
            (
              await this.prisma.postLike.findMany({
                where: { userId: viewerId, postId: { in: postIds } },
                select: { postId: true },
              })
            ).map((like) => like.postId),
          );

    return {
      items: await Promise.all(
        rows.map((row) =>
          toPostBrief(
            row as PostFeedRow,
            this.storage,
            row._count.comments,
            likedIds === undefined ? undefined : likedIds.has(row.id),
          ),
        ),
      ),
      total,
      page: pageNo,
      pageSize,
    };
  }

  // 帖子存在性校验：不存在抛 404
  private async assertPostExists(postId: number): Promise<void> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    if (!post) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '帖子不存在', 404);
    }
  }
}
