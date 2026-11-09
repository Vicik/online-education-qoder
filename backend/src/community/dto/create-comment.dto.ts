import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// 评论/回复请求：对应 openapi CommentCreateRequest
export class CreateCommentDto {
  // 评论内容（屏蔽词校验命中则阻止提交）
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content!: string;

  // 回复目标用户 id：仅回复接口使用
  @IsOptional()
  @IsInt()
  replyToUserId?: number | null;
}
