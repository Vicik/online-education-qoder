import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { FavoriteService } from './favorite.service';
import {
  FavoriteController,
  LearningController,
  LearningUserController,
} from './learning.controller';
import { LearningService } from './learning.service';

// 学习模块：章节访问进度、学习记录与课程收藏
@Module({
  imports: [CatalogModule], // 复用 CourseService 的购买权限判定
  controllers: [LearningController, LearningUserController, FavoriteController],
  providers: [LearningService, FavoriteService, IdempotencyService],
})
export class LearningModule {}
