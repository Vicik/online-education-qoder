import { useEffect, useState } from 'react';
import { Button, message } from 'antd';
import { LikeFilled, LikeOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { likePost, unlikePost } from '@/api/community';
import type { PostBrief } from '@/api/types';
import { usePermission } from '@/hooks/usePermission';
import './LikeButton.css';

// 点赞按钮：游客登录回跳；登录用户按当前状态点赞/取消
export function LikeButton(props: { post: PostBrief }) {
  // 当前用户
  const { user } = usePermission();
  // 路由跳转
  const navigate = useNavigate();
  // 当前地址（登录回跳）
  const location = useLocation();
  // 查询缓存
  const queryClient = useQueryClient();
  // 本地点赞态（服务端返回后同步）
  const [liked, setLiked] = useState(props.post.likedByMe ?? false);
  // 本地点赞数
  const [count, setCount] = useState(props.post.likeCount ?? 0);

  // 列表/详情刷新后同步本地状态
  useEffect(() => {
    setLiked(props.post.likedByMe ?? false);
    setCount(props.post.likeCount ?? 0);
  }, [props.post]);

  // 点赞/取消点赞
  const mutation = useMutation({
    mutationFn: () => (liked ? unlikePost(props.post.id ?? 0) : likePost(props.post.id ?? 0)),
    onSuccess: () => {
      // 本地即时反馈
      setLiked((prev) => !prev);
      setCount((prev) => prev + (liked ? -1 : 1));
      // 刷新信息流与详情
      void queryClient.invalidateQueries({ queryKey: ['posts'] });
      void queryClient.invalidateQueries({ queryKey: ['post', props.post.id] });
    },
    onError: (error: Error) => {
      message.error(error.message);
    },
  });

  // 已点赞时的高亮样式
  const className = liked ? 'community-action community-action-liked' : 'community-action';

  // 游客：跳登录并回跳当前地址
  if (!user) {
    return (
      <Button
        type="text"
        className={className}
        icon={<LikeOutlined aria-hidden />}
        onClick={() =>
          navigate(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`)
        }
      >
        点赞 {count}
      </Button>
    );
  }

  return (
    <Button
      type="text"
      className={className}
      icon={liked ? <LikeFilled aria-hidden /> : <LikeOutlined aria-hidden />}
      loading={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {liked ? '已点赞' : '点赞'} {count}
    </Button>
  );
}
