import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PageQuery } from '../../common/dto/page-query.dto';
import { BizException } from '../../common/exceptions/biz.exception';
import { CreatePostDto } from '../dto/create-post.dto';
import { PostService } from './post.service';

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

// 帖子控制器：信息流、详情、发帖、删帖与点赞（/api/v1/posts）
@Controller('posts')
export class PostController {
  // 构造函数：注入帖子服务
  constructor(private readonly posts: PostService) {}

  // 信息流（公开；登录用户附 likedByMe）
  @Get()
  @Public()
  list(@Query() page: PageQuery, @CurrentUser() user: CurrentUserInfo | null) {
    return this.posts.list(page, user?.userId);
  }

  // 帖子详情（公开；两层评论树）
  @Get(':id')
  @Public()
  detail(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: CurrentUserInfo | null,
  ) {
    return this.posts.getDetail(id, user?.userId);
  }

  // 发帖（登录 + 幂等）
  @Post()
  create(
    @CurrentUser() user: CurrentUserInfo | null,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreatePostDto,
  ) {
    return this.posts.create(
      user!.userId,
      dto,
      requireIdempotencyKey(idempotencyKey),
    );
  }

  // 删除自己的帖子（评论由 DB 级联删除）
  @Delete(':id')
  async remove(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.posts.remove(user!.userId, id);
    return null;
  }

  // 点赞（幂等）
  @Post(':id/like')
  @HttpCode(200)
  async like(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.posts.like(user!.userId, id);
    return null;
  }

  // 取消点赞（幂等）
  @Delete(':id/like')
  @HttpCode(200)
  async unlike(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.posts.unlike(user!.userId, id);
    return null;
  }
}

// 我的帖子控制器：仅自己发布的帖子（/api/v1/user/posts）
@Controller('user')
export class UserPostsController {
  // 构造函数：注入帖子服务
  constructor(private readonly posts: PostService) {}

  // 我的帖子分页
  @Get('posts')
  listMine(
    @CurrentUser() user: CurrentUserInfo | null,
    @Query() page: PageQuery,
  ) {
    return this.posts.listMine(user!.userId, page);
  }
}
