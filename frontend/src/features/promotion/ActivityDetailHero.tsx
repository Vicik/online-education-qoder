import { useState, type ReactNode } from 'react';
import { MoneyText } from '@/components/common/MoneyText';
import { FavoriteButton } from '@/features/catalog/FavoriteButton';
import { ActivityCountdown } from '@/features/promotion/ActivityCardFrame';
import '@/features/catalog/CourseDetailPage.css';
import './ActivityDetail.css';

// 活动详情顶部：左课程封面，右标题、红底活动条与价格，底部为主操作按钮
export function ActivityDetailHero({
  courseId,
  coverUrl,
  title,
  typeLabel,
  instructor,
  showFavorite,
  bannerText,
  deadlineAt,
  onExpire,
  priceCents,
  originalCents,
  children,
}: {
  courseId: number; // 关联课程 id：收藏与跳转用
  coverUrl: string | null; // 课程封面地址
  title: string; // 课程名称
  typeLabel?: string; // 课程类型中文名
  instructor?: string | null; // 讲师名称
  showFavorite: boolean; // 是否展示收藏入口
  bannerText: string; // 红条左侧活动文案
  deadlineAt: string; // 红条倒计时截止时间
  onExpire?: () => void; // 倒计时到期回调
  priceCents: number; // 活动价（分）
  originalCents?: number; // 课程原价（分）
  children: ReactNode; // 主操作按钮
}) {
  // 封面是否加载失败：仅本页降级为占位
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <div className="course-detail-hero">
      <div className="course-detail-cover">
        {coverUrl && !coverFailed ? (
          <img
            src={coverUrl}
            alt={title || '课程封面'}
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div className="course-detail-cover-placeholder" />
        )}
      </div>
      <div className="course-detail-info">
        <div className="course-detail-heading">
          <h1 className="course-detail-title">{title}</h1>
          {showFavorite && <FavoriteButton courseId={courseId} />}
        </div>
        <p className="course-detail-meta">
          {typeLabel && <span>【{typeLabel}】</span>}
          <span>讲师：{instructor ?? '—'}</span>
        </p>
        <div className="activity-hero-box">
          <div className="activity-hero-banner">
            <span>{bannerText}</span>
            <ActivityCountdown deadlineAt={deadlineAt} onExpire={onExpire} />
          </div>
          <div className="activity-hero-price">
            <MoneyText cents={priceCents} originalCents={originalCents} size="large" />
          </div>
        </div>
        <div className="course-detail-actions">{children}</div>
      </div>
    </div>
  );
}
