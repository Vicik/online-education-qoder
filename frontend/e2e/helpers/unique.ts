// 每次调用生成短唯一后缀，用于课程/题目/帖子名称，避免重跑冲突
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
