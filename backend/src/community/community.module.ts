import { Module } from '@nestjs/common';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { BlockedWordAdminController } from './blocked-word/blocked-word.admin.controller';
import { BlockedWordService } from './blocked-word/blocked-word.service';
import {
  CommentController,
  PostCommentsController,
} from './comment/comment.controller';
import { CommentService } from './comment/comment.service';
import { PostController, UserPostsController } from './post/post.controller';
import { PostService } from './post/post.service';

// 学习社区模块：帖子、两层评论、点赞与屏蔽词
@Module({
  controllers: [
    PostController, // 信息流 / 详情 / 发帖 / 删帖 / 点赞
    UserPostsController, // 我的帖子
    PostCommentsController, // 一级评论
    CommentController, // 回复 / 删除评论
    BlockedWordAdminController, // 管理端屏蔽词
  ],
  providers: [
    PostService,
    CommentService,
    BlockedWordService,
    IdempotencyService, // 发帖 / 评论 / 回复幂等
  ],
})
export class CommunityModule {}
