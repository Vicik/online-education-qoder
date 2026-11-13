import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { PASSWORD_REGEX } from '../../common/constants/constants';
import { Match } from './match.decorator';

// 修改密码请求 DTO：与 openapi ChangePasswordRequest 一致
export class ChangePasswordDto {
  // 当前密码（服务层校验是否正确）
  @IsString({ message: '当前密码必须是字符串' })
  @IsNotEmpty()
  currentPassword!: string;

  // 新密码：8–64 位，至少一个字母和一个数字（D6）
  @IsNotEmpty()
  @Matches(PASSWORD_REGEX, {
    message: '新密码需为 8–64 位，且同时包含字母和数字',
  })
  newPassword!: string;

  // 确认新密码：必须与 newPassword 一致
  @IsNotEmpty()
  @IsString({ message: '确认密码必须是字符串' })
  @Match('newPassword', { message: '两次输入的密码不一致' })
  confirmPassword!: string;
}
