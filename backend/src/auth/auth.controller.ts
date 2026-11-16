import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RateLimitService } from '../redis/rate-limit.service';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SessionService } from './session.service';

// 注册限流：同一 IP 每小时最多 10 次（防批量注册，D7 的替代措施）
const REGISTER_MAX_ATTEMPTS = 10;
// 注册限流窗口（秒）
const REGISTER_WINDOW_SEC = 3600;

// 认证控制器：注册/登录/登出/当前用户/改密
@Controller('auth')
export class AuthController {
  // 构造函数：注入认证服务、限流服务与会话服务
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
    private readonly sessions: SessionService,
  ) {}

  // 注册：公开接口，不自动登录（201）
  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    // 注册入口按 IP 限流
    await this.rateLimit.check(
      `register:ip:${req.ip}`,
      REGISTER_MAX_ATTEMPTS,
      REGISTER_WINDOW_SEC,
    );
    return this.auth.register(dto);
  }

  // 登录：公开接口，返回角色（200）
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req);
  }

  // 登出：吊销当前会话（200）
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request) {
    await this.auth.logout(req);
    return null;
  }

  // 当前用户资料（200）
  @Get('me')
  me(@CurrentUser() user: CurrentUserInfo | null) {
    return this.auth.me(user!.userId);
  }

  // 会话心跳：真实交互时续期 30 分钟空闲窗口（200）
  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(@Req() req: Request) {
    await this.sessions.touch(req);
    return null;
  }

  // 修改密码：成功后全部会话被吊销（200）
  @Post('password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: CurrentUserInfo | null,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(user!.userId, dto);
    return null;
  }
}
