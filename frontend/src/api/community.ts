import { request } from './client';
import type { ApiError } from './errors';
import type {
  CommentView,
  PageResult,
  PostBrief,
  PostDetail,
  ReplyView,
} from './types';

// 信息流（公开；登录用户附 likedByMe）
export function listPosts(page = 1, pageSize = 10): Promise<PageResult<PostBrief>> {
  return request<PageResult<PostBrief>>({
    url: '/posts',
    method: 'GET',
    params: { page, pageSize },
  });
}

// 帖子详情（公开；两层评论）
export function getPost(postId: number): Promise<PostDetail> {
  return request<PostDetail>({ url: `/posts/${postId}`, method: 'GET' });
}

// 发帖：富文本内容 + 幂等键
export function createPost(
  payload: { content: string },
  idempotencyKey: string,
): Promise<PostBrief> {
  return request<PostBrief>({
    url: '/posts',
    method: 'POST',
    data: payload,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 删除自己的帖子（评论由后端级联删除）
export function deletePost(postId: number): Promise<void> {
  return request<void>({ url: `/posts/${postId}`, method: 'DELETE' });
}

// 点赞（幂等，无需幂等键）
export function likePost(postId: number): Promise<void> {
  return request<void>({ url: `/posts/${postId}/like`, method: 'POST', data: {} });
}

// 取消点赞（幂等）
export function unlikePost(postId: number): Promise<void> {
  return request<void>({ url: `/posts/${postId}/like`, method: 'DELETE' });
}

// 发表一级评论：幂等键
export function createComment(
  postId: number,
  payload: { content: string },
  idempotencyKey: string,
): Promise<CommentView> {
  return request<CommentView>({
    url: `/posts/${postId}/comments`,
    method: 'POST',
    data: payload,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 回复一级评论：不产生第三层，replyToUserId 表达回复目标
export function createReply(
  commentId: number,
  payload: { content: string; replyToUserId: number | null },
  idempotencyKey: string,
): Promise<ReplyView> {
  return request<ReplyView>({
    url: `/comments/${commentId}/replies`,
    method: 'POST',
    data: payload,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 删除自己的评论（一级评论级联删除回复）
export function deleteComment(commentId: number): Promise<void> {
  return request<void>({ url: `/comments/${commentId}`, method: 'DELETE' });
}

// 我的帖子（仅自己发布）
export function listMyPosts(page = 1, pageSize = 10): Promise<PageResult<PostBrief>> {
  return request<PageResult<PostBrief>>({
    url: '/user/posts',
    method: 'GET',
    params: { page, pageSize },
  });
}

// 从 7001 错误中提取命中词：后端 data 为字符串数组
export function extractBlockedWords(error: ApiError): string[] {
  return Array.isArray(error.data)
    ? error.data.filter((word): word is string => typeof word === 'string')
    : [];
}
