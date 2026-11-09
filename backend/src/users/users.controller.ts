import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

// 用户中心控制器：个人资料与学习概览
@Controller('user')
export class UsersController {
  // 构造函数：注入用户中心服务
  constructor(private readonly users: UsersService) {}

  // 个人资料（邮箱只读）
  @Get('profile')
  getProfile(@CurrentUser() user: CurrentUserInfo | null) {
    return this.users.getProfile(user!.userId);
  }

  // 修改资料（仅昵称/头像/性别）
  @Put('profile')
  updateProfile(
    @CurrentUser() user: CurrentUserInfo | null,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.users.updateProfile(user!.userId, dto);
  }

  // 学习概览统计
  @Get('overview')
  getOverview(@CurrentUser() user: CurrentUserInfo | null) {
    return this.users.getOverview(user!.userId);
  }
}
