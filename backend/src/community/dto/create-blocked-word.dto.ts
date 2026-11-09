import { EnabledStatus } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// 新增屏蔽词请求：对应 openapi BlockedWordCreateRequest
export class CreateBlockedWordDto {
  // 屏蔽词文本（包含匹配、忽略英文大小写）
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  word!: string;
}

// 修改屏蔽词请求：word/status 均可选，至少按需修改其一
export class UpdateBlockedWordDto {
  // 新的屏蔽词文本
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  word?: string;

  // 启用 / 停用
  @IsOptional()
  @IsEnum(EnabledStatus)
  status?: EnabledStatus;
}
