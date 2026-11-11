import { useState } from 'react';
import { Button, Card, Space, Typography, message } from 'antd';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { createReply, deleteComment, extractBlockedWords } from '@/api/community';
import type { ApiError } from '@/api/errors';
import type { PostDetail, ReplyView } from '@/api/types';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { useIdempotentMutation } from '@/hooks/useIdempotentMutation';
import { usePermission } from '@/hooks/usePermission';
import { formatShanghai } from '@/lib/datetime';
import { CommentForm } from './CommentForm';

// 两级评论树：一级评论 + 回复；回复目标显示「回复 @昵称」
export function CommentTree(props: { post: PostDetail }) {
  // 当前用户
  const { user } = usePermission();
  // 路由跳转
  const navigate = useNavigate();
  // 当前地址（登录回跳）
  const location = useLocation();
  // 查询缓存
  const queryClient = useQueryClient();
  // 正在回复的一级评论 id
  const [replyingTo, setReplyingTo] = useState<number | null>(null);

  // 游客跳登录
  const requireLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
  };

  // 刷新详情
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['post', props.post.id] });
    void queryClient.invalidateQueries({ queryKey: ['posts'] });
  };

  // 删除评论（仅本人入口可见）
  const handleDelete = async (commentId: number) => {
    try {
      await deleteComment(commentId);
      message.success('已删除');
      refresh();
    } catch (error) {
      message.error((error as ApiError).message);
    }
  };

  // 回复一级评论：一次用户意图一个幂等键
  const replyMutation = useIdempotentMutation<
    ReplyView,
    { commentId: number; replyToUserId: number; content: string }
  >(
    (vars, key) =>
      createReply(
        vars.commentId,
        { content: vars.content, replyToUserId: vars.replyToUserId },
        key,
      ),
    {
      onSuccess: () => {
        message.success('回复成功');
        setReplyingTo(null);
        refresh();
      },
      onError: (error) => {
        const words = extractBlockedWords(error);
        message.error(
          words.length > 0 ? `内容包含屏蔽词：${words.join('、')}` : error.message,
        );
      },
    },
  );

  // 提交回复：成功返回 true，由 CommentForm 清空输入
  const handleReply = async (
    commentId: number,
    replyToUserId: number,
    content: string,
  ): Promise<boolean> => {
    try {
      await replyMutation.mutateAsync({ commentId, replyToUserId, content });
      return true;
    } catch {
      return false;
    }
  };

  // 一级评论列表
  const comments = props.post.comments ?? [];

  return (
    <div>
      {comments.map((comment) => (
        <Card key={comment.id} size="small" style={{ marginBottom: 12 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <Typography.Text strong>{comment.nickname}</Typography.Text>
              <Typography.Text type="secondary">
                {formatShanghai(comment.createdAt ?? '')}
              </Typography.Text>
            </Space>
            <RichTextViewer html={comment.content ?? ''} />
            <Space>
              <Button
                type="link"
                onClick={() => (user ? setReplyingTo(comment.id ?? null) : requireLogin())}
              >
                回复
              </Button>
              {user?.id === comment.userId && (
                <ConfirmAction
                  title="删除评论"
                  content="删除一级评论会同时删除其全部回复，确认删除？"
                  danger
                  onConfirm={() => handleDelete(comment.id ?? 0)}
                >
                  <Button type="link" danger>
                    删除评论
                  </Button>
                </ConfirmAction>
              )}
            </Space>

            {(comment.replies ?? []).map((reply) => (
              <Card key={reply.id} size="small" type="inner">
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space>
                    <Typography.Text strong>{reply.nickname}</Typography.Text>
                    {reply.replyToNickname && (
                      <Typography.Text type="secondary">
                        回复 @{reply.replyToNickname}
                      </Typography.Text>
                    )}
                    <Typography.Text type="secondary">
                      {formatShanghai(reply.createdAt ?? '')}
                    </Typography.Text>
                  </Space>
                  <RichTextViewer html={reply.content ?? ''} />
                </Space>
              </Card>
            ))}

            {replyingTo === comment.id && (
              <CommentForm
                placeholder={`回复 @${comment.nickname}`}
                submitting={replyMutation.isPending}
                onSubmit={(content) =>
                  handleReply(comment.id ?? 0, comment.userId ?? 0, content)
                }
              />
            )}
          </Space>
        </Card>
      ))}
    </div>
  );
}
