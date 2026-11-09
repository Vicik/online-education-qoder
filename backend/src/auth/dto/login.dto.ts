import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

// 登录请求 DTO：与 openapi LoginRequest 一致
export class LoginDto {
  // 登录邮箱
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  // 登录密码（登录时不重复校验强度）
  @IsString({ message: '密码必须是字符串' })
  password!: string;

  // 管理员 TOTP 动态码：可选字段，存在时必须是 6 位数字（admin 必填由服务层校验）
  @IsOptional()
  @Matches(/^\d{6}$/, { message: '动态验证码必须是 6 位数字' })
  totpCode?: string;
}
