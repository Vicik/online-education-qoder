import {
  Body,
  Controller,
  Delete,
  Headers,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../../common/decorators/current-user.decorator';
import { BizException } from '../../common/exceptions/biz.exception';
import { CommentService } from './comment.service';
import { CreateCommentDto } from '../dto/create-comment.dto';

// 幂等键校验：创建类 POST 必带 8–128 字符的 Idempotency-Key
function requireIdempotencyKey(raw: string | undefined): string {
  // 去除首尾空白后的键
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (key.length < 8 || key.length > 128) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      'Idempotency-Key 长度须为 8-128 字符',
      400,
    );
  }
  return key;
}

// 一级评论控制器：发表评论（/api/v1/posts/:id/comments）
@Controller('posts')
export class PostCommentsController {
  // 构造函数：注入评论服务
  constructor(private readonly comments: CommentService) {}

  // 发表一级评论（登录 + 幂等）
  @Post(':id/comments')
  create(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) postId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(
      user!.userId,
      postId,
      dto,
      requireIdempotencyKey(idempotencyKey),
    );
  }
}

// 评论控制器：回复与删除（/api/v1/comments）
@Controller('comments')
export class CommentController {
  // 构造函数：注入评论服务
  constructor(private readonly comments: CommentService) {}

  // 回复一级评论（登录 + 幂等；不产生第三层）
  @Post(':id/replies')
  reply(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) parentId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.reply(
      user!.userId,
      parentId,
      dto,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  // 删除自己的评论（一级评论级联删除其回复）
  @Delete(':id')
  async remove(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.comments.remove(user!.userId, id);
    return null;
  }
}
