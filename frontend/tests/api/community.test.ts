import { http, HttpResponse } from 'msw';
import { createComment, createPost, createReply, listPosts } from '@/api/community';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-community' };
}

// 帖子桩
const post = {
  id: 1,
  userId: 1,
  nickname: '学员',
  avatarKey: null,
  avatarUrl: null,
  content: '<p>第一帖</p>',
  likeCount: 0,
  likedByMe: false,
  commentCount: 0,
  createdAt: '2026-11-10T00:00:00.000Z',
};

describe('community api', () => {
  it('信息流透传分页参数', async () => {
    // 捕获页码
    let page = '';
    server.use(
      http.get(/\/api\/v1\/posts$/, ({ request }) => {
        page = new URL(request.url).searchParams.get('page') ?? '';
        return HttpResponse.json(envelope({ items: [post], total: 1, page: 2, pageSize: 10 }));
      }),
    );

    const result = await listPosts(2, 10);
    expect(page).toBe('2');
    expect(result.items[0].content).toBe('<p>第一帖</p>');
  });

  it('发帖、评论、回复均携带幂等键', async () => {
    // 发帖幂等键
    let postKey = '';
    // 评论幂等键
    let commentKey = '';
    // 回复幂等键
    let replyKey = '';
    server.use(
      http.post(/\/api\/v1\/posts$/, ({ request }) => {
        postKey = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(envelope(post), { status: 201 });
      }),
      http.post(/\/api\/v1\/posts\/1\/comments$/, ({ request }) => {
        commentKey = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(
          envelope({
            id: 11,
            userId: 1,
            nickname: '学员',
            content: '<p>评论</p>',
            createdAt: '2026-11-10T00:00:00.000Z',
            replies: [],
          }),
          { status: 201 },
        );
      }),
      http.post(/\/api\/v1\/comments\/11\/replies$/, ({ request }) => {
        replyKey = request.headers.get('idempotency-key') ?? '';
        return HttpResponse.json(
          envelope({
            id: 12,
            userId: 2,
            nickname: '小明',
            replyToNickname: '学员',
            content: '<p>回复</p>',
            createdAt: '2026-11-10T00:00:00.000Z',
          }),
          { status: 201 },
        );
      }),
    );

    await createPost({ content: '<p>第一帖</p>' }, 'key-post-123');
    await createComment(1, { content: '<p>评论</p>' }, 'key-comment-123');
    await createReply(11, { content: '<p>回复</p>', replyToUserId: 1 }, 'key-reply-123');

    expect(postKey).toBe('key-post-123');
    expect(commentKey).toBe('key-comment-123');
    expect(replyKey).toBe('key-reply-123');
  });
});
