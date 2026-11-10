import type { RequestHandler } from 'msw';

// 默认无接口桩；步骤 02 起按接口逐步追加
export const handlers: RequestHandler[] = [];
