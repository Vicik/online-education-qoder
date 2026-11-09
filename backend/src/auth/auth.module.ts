import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';

// 认证模块：会话、TOTP 与账号接口
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, TotpService],
  exports: [AuthService, SessionService, TotpService],
})
export class AuthModule {}
