import { Button, Card, message, Space, Typography } from 'antd';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createComment, deletePost, extractBlockedWords, getPost } from '@/api/community';
import type { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { CommentView } from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { EmptyState } from '@/components/common/EmptyState';
import { PageHeader } from '@/components/common/PageHeader';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { usePermission } from '@/hooks/usePermission';
import { formatShanghai } from '@/lib/datetime';
import { CommentForm } from './CommentForm';
import { CommentTree } from './CommentTree';
import { LikeButton } from './LikeButton';

// 帖子详情：内容、点赞、评论、回复与删除
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

  if (query.isLoading) return <Card loading />;
  if (query.error || !query.data) {
    return (
      <EmptyState
        description="帖子不存在"
        action={<Button onClick={() => navigate('/community')}>返回社区</Button>}
      />
    );
  }

  // 帖子详情
  const post = query.data;
  // 是否本人帖子
  const isOwner = user?.id === post.userId;

  return (
    <div>
      <PageHeader
        title="帖子详情"
        extra={
          isOwner ? (
            <ConfirmAction
              title="删除帖子"
              content="删除后帖子与全部评论不可恢复，确认删除？"
              danger
              onConfirm={handleDeletePost}
            >
              <Button danger>删除帖子</Button>
            </ConfirmAction>
          ) : undefined
        }
      />
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Typography.Text strong>{post.nickname}</Typography.Text>
            <Typography.Text type="secondary">
              {formatShanghai(post.createdAt ?? '')}
            </Typography.Text>
          </Space>
          <RichTextViewer html={post.content ?? ''} />
          <LikeButton post={post} />
        </Space>
      </Card>

      <Card title={`评论 ${post.commentCount ?? 0}`}>
        {user ? (
          <div style={{ marginBottom: 16 }}>
            <CommentForm
              placeholder="写下你的评论"
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
          </div>
        ) : (
          <Button type="link" onClick={gotoLogin}>
            登录后发表评论
          </Button>
        )}
        <CommentTree post={post} />
      </Card>
    </div>
  );
}
