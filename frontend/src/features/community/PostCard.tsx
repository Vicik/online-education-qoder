import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { MessageOutlined } from '@ant-design/icons';
import type { PostBrief } from '@/api/types';
import { RichTextViewer } from '@/components/common/RichTextViewer';
import { formatShanghai } from '@/lib/datetime';
import { LikeButton } from './LikeButton';
import { normalizePostHtml, truncatePostHtml } from './normalizePostHtml';

// 信息流正文：先截取前 100 字，再规范化为段落与图集
function transformFeedHtml(html: string): string {
  return normalizePostHtml(truncatePostHtml(html));
}

// 帖子卡片：正文在上，点赞、评论与作者信息在底部；footerExtra 追加页面级操作
export function PostCard(props: { post: PostBrief; footerExtra?: ReactNode }) {
  // 路由跳转
  const navigate = useNavigate();
  // 帖子详情地址
  const detailPath = `/community/${props.post.id}`;

  // 点击正文进入详情：图片点击用于预览、链接与选中的文字不跳转
  function handleBodyClick(event: React.MouseEvent<HTMLDivElement>) {
    // 命中的元素
    const target = event.target as HTMLElement;
    if (target.closest('img, a, button')) return;
    if (window.getSelection()?.toString()) return;
    navigate(detailPath);
  }

  // 键盘进入详情：与点击正文等价
  function handleBodyKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter') navigate(detailPath);
  }

  return (
    <article className="community-post">
      <div
        className="community-post-body"
        role="link"
        tabIndex={0}
        aria-label="查看帖子详情"
        onClick={handleBodyClick}
        onKeyDown={handleBodyKeyDown}
      >
        <RichTextViewer
          html={props.post.content ?? ''}
          className="community-post-content"
          transform={transformFeedHtml}
        />
      </div>
      <div className="community-post-footer">
        <LikeButton post={props.post} />
        <Link to={detailPath} className="community-action">
          <MessageOutlined aria-hidden />
          评论 {props.post.commentCount ?? 0}
        </Link>
        <span className="community-post-author">
          作者：{props.post.nickname ?? '匿名'} · {formatShanghai(props.post.createdAt ?? '')}
        </span>
        {props.footerExtra}
      </div>
    </article>
  );
}
