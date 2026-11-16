import { Avatar, Breadcrumb, Button, Skeleton, message } from 'antd';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createComment, deletePost, extractBlockedWords, getPost } from '@/api/community';
import type { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { CommentView } from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { EmptyState } from '@/components/common/EmptyState';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { usePermission } from '@/hooks/usePermission';
import { formatShanghai } from '@/lib/datetime';
import { CommentForm } from './CommentForm';
import { CommentTree } from './CommentTree';
import { CommunitySidebar } from './CommunitySidebar';
import { LikeButton } from './LikeButton';
import { postPlainText } from './normalizePostHtml';
// 复用社区卡片的两栏布局、侧栏与按钮样式
import './FeedPage.css';
import './PostDetailPage.css';

// 面包屑尾项最大字数
const BREADCRUMB_LENGTH = 20;

// 帖子详情：作者信息、正文、点赞与评论，右侧为发布入口与精品推荐
export default function PostDetailPage() {
  // 路由参数
  const params = useParams();
  // 帖子 id
  const postId = Number(params.postId);
  // 路由跳转
  const navigate = useNavigate();
  // 当前地址（登录回跳）
  const location = useLocation();
  // 查询缓存
  const queryClient = useQueryClient();
  // 当前用户
  const { user } = usePermission();

  // 帖子详情
  const query = useQuery({
    queryKey: queryKeys.post(postId),
    queryFn: () => getPost(postId),
    enabled: Number.isInteger(postId) && postId > 0,
  });

  // 发表一级评论：一次意图一个幂等键
  const commentMutation = useIdempotentMutation<CommentView, { content: string }>(
    (vars, key) => createComment(postId, vars, key),
    {
      onSuccess: () => {
        message.success('评论成功');
        void queryClient.invalidateQueries({ queryKey: queryKeys.post(postId) });
        void queryClient.invalidateQueries({ queryKey: ['posts'] });
      },
      onError: (error) => {
        const words = extractBlockedWords(error);
        message.error(words.length > 0 ? `内容包含屏蔽词：${words.join('、')}` : error.message);
      },
    },
  );

  // 删除自己的帖子
  const handleDeletePost = async () => {
    try {
      await deletePost(postId);
      message.success('已删除');
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
      navigate('/community');
    } catch (error) {
      message.error((error as ApiError).message);
    }
  };

  // 游客跳登录
  const gotoLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
  };

  if (query.isLoading) {
    return (
      <div className="community-page">
        <div className="community-main">
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
        <CommunitySidebar />
      </div>
    );
  }

  if (query.error || !query.data) {
    return (
      <div className="community-page">
        <div className="community-main">
          <EmptyState
            description="帖子不存在"
            action={<Button onClick={() => navigate('/community')}>返回社区</Button>}
          />
        </div>
        <CommunitySidebar />
      </div>
    );
  }

  // 帖子详情
  const post = query.data;
  // 是否本人帖子
  const isOwner = user?.id === post.userId;
  // 正文纯文本
  const summary = postPlainText(post.content ?? '');
  // 面包屑尾项：没有标题，用正文开头代替
  const crumb = summary
    ? summary.length > BREADCRUMB_LENGTH
      ? `${summary.slice(0, BREADCRUMB_LENGTH)}…`
      : summary
    : '帖子详情';

  return (
    <div className="community-page">
      <div className="community-main post-detail">
        <Breadcrumb
          className="post-detail-breadcrumb"
          items={[
            { title: <Link to="/">首页</Link> },
            { title: <Link to="/community">社区列表</Link> },
            { title: crumb },
          ]}
        />

        <div className="post-detail-header">
          <Avatar
            className="post-detail-avatar"
            shape="square"
            size={56}
            src={post.avatarUrl ?? undefined}
          >
            {(post.nickname ?? '?').slice(0, 1)}
          </Avatar>
          <div className="post-detail-meta">
            <span className="post-detail-author">{post.nickname}</span>
            <span className="post-detail-time">
              发布时间：{formatShanghai(post.createdAt ?? '')}
            </span>
          </div>
          {isOwner && (
            <ConfirmAction
              title="删除帖子"
              content="删除后帖子与全部评论不可恢复，确认删除？"
              danger
              onConfirm={handleDeletePost}
            >
              <Button danger className="post-detail-delete">
                删除帖子
              </Button>
            </ConfirmAction>
          )}
        </div>

        <div className="post-detail-body">
          <RichTextViewer html={post.content ?? ''} />
        </div>

        <div className="post-detail-like">
          <LikeButton post={post} />
        </div>

        <section className="post-detail-comments" aria-label="评论区">
          {user ? (
            <CommentForm
              placeholder="说两句吧~"
              submitText="回复"
              submitting={commentMutation.isPending}
              onSubmit={async (content) => {
                try {
                  await commentMutation.mutateAsync({ content });
                  return true;
                } catch {
                  return false;
                }
              }}
            />
          ) : (
            <Button type="link" onClick={gotoLogin}>
              登录后发表评论
            </Button>
          )}
          <h2 className="post-detail-comments-title">精彩评论</h2>
          <CommentTree post={post} />
        </section>
      </div>
      <CommunitySidebar />
    </div>
  );
}
