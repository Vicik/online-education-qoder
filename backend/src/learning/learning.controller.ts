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
import { IsInt } from 'class-validator';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../common/decorators/current-user.decorator';
import { ErrorCode } from '../common/constants/error-codes';
import { PageQuery } from '../common/dto/page-query.dto';
import { BizException } from '../common/exceptions/biz.exception';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { FavoriteService } from './favorite.service';
import { LearningService } from './learning.service';

// 收藏请求体：仅课程 id
class FavoriteCreateDto {
  // 课程 id
  @IsInt()
  courseId: number;
}

// 学习控制器：记录章节访问
@Controller('learning')
export class LearningController {
  // 构造函数：注入学习服务
  constructor(private readonly learning: LearningService) {}

  // 记录章节访问（登录 + 已购；返回进度与是否学完）
  @Post(':courseId/chapters/:cid/visit')
  @HttpCode(200)
  recordVisit(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('cid', ParseIntPipe) chapterId: number,
  ) {
    return this.learning.recordVisit(user!.userId, courseId, chapterId);
  }
}

// 用户学习记录控制器：学习记录与我的收藏
@Controller('user')
export class LearningUserController {
  // 构造函数：注入学习服务与收藏服务
  constructor(
    private readonly learning: LearningService,
    private readonly favoriteService: FavoriteService,
  ) {}

  // 学习记录分页
  @Get('study-records')
  studyRecords(
    @CurrentUser() user: CurrentUserInfo | null,
    @Query() page: PageQuery,
  ) {
    return this.learning.getStudyRecords(user!.userId, page);
  }

  // 我的收藏分页
  @Get('favorites')
  favorites(
    @CurrentUser() user: CurrentUserInfo | null,
    @Query() page: PageQuery,
  ) {
    return this.favoriteService.list(user!.userId, page);
  }
}

// 收藏控制器：收藏（幂等）/取消收藏
@Controller('favorites')
export class FavoriteController {
  // 构造函数：注入收藏服务与幂等服务
  constructor(
    private readonly favoriteService: FavoriteService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // 收藏课程（登录 + Idempotency-Key；201）
  @Post()
  async add(
    @CurrentUser() user: CurrentUserInfo | null,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: FavoriteCreateDto,
  ) {
    // 幂等键边界校验：8–128 字符
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (key.length < 8 || key.length > 128) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        'Idempotency-Key 长度须为 8-128 字符',
        400,
      );
    }

    // 首次执行写入收藏，重放返回缓存结果
    // （返回可序列化对象而非 undefined，供幂等服务缓存）
    await this.idempotency.run(
      user!.userId,
      key,
      'POST /favorites',
      async () => {
        await this.favoriteService.add(user!.userId, dto.courseId);
        return { favorited: true };
      },
    );
    return null;
  }

  // 取消收藏（幂等）
  @Delete(':courseId')
  async remove(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('courseId', ParseIntPipe) courseId: number,
  ) {
    await this.favoriteService.remove(user!.userId, courseId);
    return null;
  }
}
