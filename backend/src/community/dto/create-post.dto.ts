import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// 发帖请求：对应 openapi PostCreateRequest
export class CreatePostDto {
  // 帖子内容（屏蔽词校验命中则阻止提交）
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;
}
