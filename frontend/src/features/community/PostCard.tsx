import { Avatar, Card, Space, Typography } from 'antd';
import { Link } from 'react-router';
import type { PostBrief } from '@/api/types';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { formatShanghai } from '@/lib/datetime';
import { LikeButton } from './LikeButton';

// 帖子卡片：作者、时间、富文本内容、点赞与评论入口
export function PostCard(props: { post: PostBrief }) {
  return (
    <Card style={{ marginBottom: 12 }}>
      <Space align="start" size={12}>
        <Avatar src={props.post.avatarUrl ?? undefined}>
          {(props.post.nickname ?? '').slice(0, 1)}
        </Avatar>
        <div style={{ flex: 1 }}>
          <Typography.Text strong>{props.post.nickname}</Typography.Text>
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            {formatShanghai(props.post.createdAt ?? '')}
          </Typography.Text>
          <div style={{ marginTop: 8 }}>
            <RichTextViewer html={props.post.content ?? ''} />
          </div>
          <Space size={16} style={{ marginTop: 8 }}>
            <LikeButton post={props.post} />
            <Link to={`/community/${props.post.id}`}>评论 {props.post.commentCount ?? 0}</Link>
          </Space>
        </div>
      </Space>
    </Card>
  );
}
