import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import { BizException } from '../../common/exceptions/biz.exception';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { sanitizeRichHtml } from '../../common/utils/sanitize.util';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { BlockedWordService } from '../blocked-word/blocked-word.service';
import { CreateCommentDto } from '../dto/create-comment.dto';
import { CommentView, ReplyView } from '../post/post.service';

// 新建评论行：含评论人昵称
interface CreatedCommentRow {
  id: number; // 评论 id
  userId: number; // 评论人 id
  content: string; // 内容
  createdAt: Date; // 创建时间
  replyToUserId: number | null; // 回复目标用户 id
  user: { nickname: string }; // 评论人
}

// 评论服务：一级评论、回复（仅两层）与删除
@Injectable()
export class CommentService {
  // 构造函数：注入 Prisma、屏蔽词、幂等与存储签名服务
  constructor(
    private readonly prisma: PrismaService,
    private readonly blockedWords: BlockedWordService,
    private readonly idempotency: IdempotencyService,
    private readonly storage: StorageService,
  ) {}

  // 发表一级评论：帖子必须存在，内容净化 + 屏蔽词校验
  async create(
    userId: number,
    postId: number,
    dto: CreateCommentDto,
    idempotencyKey: string,
  ): Promise<CommentView> {
    await this.assertPostExists(postId);
    await this.blockedWords.assertAllowed(dto.content);
    // 富文本按白名单净化后落库
    const content = sanitizeRichHtml(dto.content);

    return this.idempotency.run(
      userId,
      idempotencyKey,
      `POST /posts/${postId}/comments`,
      async () => {
        const created = (await this.prisma.comment.create({
          data: { postId, userId, content, parentId: null },
          include: { user: { select: { nickname: true } } },
        })) as CreatedCommentRow;

        return {
          id: created.id,
          userId: created.userId,
          nickname: created.user.nickname,
          content: await this.storage.signRichHtml(created.content),
          createdAt: created.createdAt,
          replies: [],
        };
      },
    );
  }

  // 回复：必须挂在一级评论下（不产生第三层），replyToUserId 表达回复目标
  async reply(
    userId: number,
    parentCommentId: number,
    dto: CreateCommentDto,
    idempotencyKey: string,
  ): Promise<ReplyView> {
    // 父评论必须存在
    const parent = await this.prisma.comment.findUnique({
      where: { id: parentCommentId },
      select: { id: true, parentId: true, postId: true },
    });
    if (!parent) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '评论不存在', 404);
    }
    // 仅允许回复一级评论，避免出现第三层
    if (parent.parentId !== null) {
      throw new BizException(ErrorCode.PARAM_INVALID, '只能回复一级评论', 400);
    }

    await this.blockedWords.assertAllowed(dto.content);
    // 富文本按白名单净化后落库
    const content = sanitizeRichHtml(dto.content);

    return this.idempotency.run(
      userId,
      idempotencyKey,
      `POST /comments/${parentCommentId}/replies`,
      async () => {
        const created = (await this.prisma.comment.create({
          data: {
            postId: parent.postId,
            userId,
            content,
            parentId: parent.id,
            replyToUserId: dto.replyToUserId ?? null,
          },
          include: { user: { select: { nickname: true } } },
        })) as CreatedCommentRow;

        // 被回复人昵称：未指定目标时为 null
        const replyToNickname =
          created.replyToUserId === null
            ? null
            : ((
                await this.prisma.user.findUnique({
                  where: { id: created.replyToUserId },
                  select: { nickname: true },
                })
              )?.nickname ?? null);

        return {
          id: created.id,
          userId: created.userId,
          nickname: created.user.nickname,
          replyToNickname,
          content: await this.storage.signRichHtml(created.content),
          createdAt: created.createdAt,
        };
      },
    );
  }

  // 删除自己的评论：一级评论的回复由 DB 自关联级联删除
  async remove(userId: number, commentId: number): Promise<void> {
    // 评论必须存在
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true },
    });
    if (!comment) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '评论不存在', 404);
    }
    // 仅作者本人可删（防 IDOR）
    if (comment.userId !== userId) {
      throw new BizException(ErrorCode.FORBIDDEN, '无权删除他人的评论', 403);
    }

    await this.prisma.comment.delete({ where: { id: commentId } });
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
