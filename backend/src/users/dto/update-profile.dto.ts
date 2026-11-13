import { Gender } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// 修改资料请求 DTO：与 openapi ProfileUpdateRequest 一致
export class UpdateProfileDto {
  // 昵称：最长 30 字符，必填
  @IsString({ message: '昵称必须是字符串' })
  @IsNotEmpty()
  @MaxLength(30, { message: '昵称不能超过 30 个字符' })
  nickname!: string;

  // 头像 URL：可选；传 null 表示清空头像
  @IsOptional()
  @IsString({ message: '头像地址必须是字符串' })
  @MaxLength(500, { message: '头像地址过长' })
  avatarUrl?: string | null;

  // 性别：male / female / secret，必填
  @IsEnum(Gender, { message: '性别取值不合法' })
  gender!: Gender;
}
