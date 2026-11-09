// 会话存储键前缀：Redis 中的会话键形如 sess:{sessionId}（与 connect-redis 前缀一致）
export const SESSION_KEY_PREFIX = 'sess:';

// 用户会话集合键：记录某用户当前全部在线会话的 sessionId，用于全端吊销
export function userSessionsKey(userId: number): string {
  return `user_sessions:${userId}`;
}
