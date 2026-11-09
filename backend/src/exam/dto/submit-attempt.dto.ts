import { IsObject } from 'class-validator';

// 交卷请求：对应 openapi SubmitRequest
export class SubmitAttemptDto {
  // 用户答案：题 id -> 选项 key 数组
  @IsObject()
  answers!: Record<string, string[]>;
}
