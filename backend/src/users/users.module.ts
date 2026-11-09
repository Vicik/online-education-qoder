import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// 用户中心模块：个人资料与学习概览
@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
