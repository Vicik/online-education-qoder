import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PASSWORD_REGEX } from '../../common/constants/constants';
import { Match } from './match.decorator';

// 注册请求 DTO：与 openapi RegisterRequest 一致
export class RegisterDto {
  // 登录邮箱
  @IsNotEmpty()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  // 密码：8–64 位，至少一个字母和一个数字（D6）
  @IsNotEmpty()
  @Matches(PASSWORD_REGEX, {
    message: '密码需为 8–64 位，且同时包含字母和数字',
  })
  password!: string;

  // 确认密码：必须与 password 一致
  @IsNotEmpty({ message: '确认密码不能为空' })
  @IsString({ message: '确认密码必须是字符串' })
  @Match('password', { message: '两次输入的密码不一致' })
  confirmPassword!: string;

  // 昵称：最长 30 字符
  @IsString({ message: '昵称必须是字符串' })
  @IsNotEmpty()
  @MaxLength(30, { message: '昵称不能超过 30 个字符' })
  nickname!: string;
}
