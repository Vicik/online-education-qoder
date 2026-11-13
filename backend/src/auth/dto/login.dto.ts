import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

// 登录请求 DTO：与 openapi LoginRequest 一致
export class LoginDto {
  // 登录邮箱
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  // 登录密码（登录时不重复校验强度）
  @IsString({ message: '密码必须是字符串' })
  @IsNotEmpty()
  password!: string;
}
