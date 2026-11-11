import { request } from '../client';
import type {
  AdminBlockedWord,
  BlockedWordCreateInput,
  BlockedWordStatus,
  BlockedWordUpdateInput,
  PageResult,
} from '../types';

// 管理端屏蔽词列表：状态可选筛选
export function listBlockedWords(
  page = 1,
  pageSize = 10,
  status?: BlockedWordStatus,
): Promise<PageResult<AdminBlockedWord>> {
  return request<PageResult<AdminBlockedWord>>({
    url: '/admin/blocked-words',
    method: 'GET',
    params: { page, pageSize, ...(status ? { status } : {}) },
  });
}

// 新增屏蔽词：去首尾空白由服务端处理；创建类 POST 携带幂等键
export function createBlockedWord(
  input: BlockedWordCreateInput,
  idempotencyKey: string,
): Promise<AdminBlockedWord> {
  return request<AdminBlockedWord>({
    url: '/admin/blocked-words',
    method: 'POST',
    data: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 修改词文本或启停状态
export function updateBlockedWord(
  blockedWordId: number,
  input: BlockedWordUpdateInput,
): Promise<void> {
  return request<void>({
    url: `/admin/blocked-words/${blockedWordId}`,
    method: 'PUT',
    data: input,
  });
}

// 删除屏蔽词
export function deleteBlockedWord(blockedWordId: number): Promise<void> {
  return request<void>({
    url: `/admin/blocked-words/${blockedWordId}`,
    method: 'DELETE',
  });
}
