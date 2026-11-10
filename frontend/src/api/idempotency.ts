// 生成幂等键：36 字符 UUID，满足后端 8–128 要求
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
