import { useState } from 'react';
import { Link } from 'react-router';
import { MoneyText } from '@/components/common/MoneyText';
import { useCountdown } from '@/hooks/useCountdown';
import './ActivityCardFrame.css';

// 活动倒计时：白底数字块，按「天 时:分:秒」拆分
export function ActivityCountdown({
  deadlineAt,
  onExpire,
}: {
  deadlineAt: string;
  onExpire?: () => void;
}) {
  // 剩余毫秒：基于服务端校准时间
  const remainingMs = useCountdown(deadlineAt, onExpire);
  // 总秒数（不为负）
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  // 天数
  const days = Math.floor(totalSeconds / 86400);
  // 小时（两位）
  const hours = String(Math.floor((totalSeconds % 86400) / 3600)).padStart(2, '0');
  // 分钟（两位）
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  // 秒（两位）
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return (
    <span className="activity-countdown">
      <span className="activity-countdown-label">倒计时</span>
      <span className="activity-countdown-box">{days}</span>
      <span className="activity-countdown-unit">天</span>
      <span className="activity-countdown-box">{hours}</span>
      <span className="activity-countdown-sep">:</span>
      <span className="activity-countdown-box">{minutes}</span>
      <span className="activity-countdown-sep">:</span>
      <span className="activity-countdown-box">{seconds}</span>
    </span>
  );
}

// 活动卡片外框：封面上置、课程标题、活动价与彩色页脚，整卡跳课程详情
export function ActivityCardFrame({
  courseId,
  source,
  courseName,
  coverUrl,
  priceCents,
  originalCents,
  footerColor,
  footerLabel,
  deadlineAt,
  onExpire,
}: {
  courseId: number; // 跳转的课程 id
  source: 'groupon' | 'flash'; // 来源活动：详情页据此高亮顶部导航
  courseName: string; // 卡片标题：课程名称
  coverUrl: string | null; // 课程封面地址
  priceCents: number; // 活动价（分）
  originalCents?: number; // 课程原价（分）
  footerColor: string; // 页脚底色（拼团橙/秒杀橙）
  footerLabel: string; // 页脚状态文案
  deadlineAt?: string; // 倒计时截止时间；缺省不展示
  onExpire?: () => void; // 倒计时到期回调
}) {
  // 封面是否加载失败：仅本卡片降级为占位
  const [failed, setFailed] = useState(false);

  return (
    <Link to={`/courses/${courseId}?from=${source}`} className="activity-card">
      <div className="activity-card-cover">
        {coverUrl && !failed ? (
          <img
            src={coverUrl}
            alt={courseName}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="activity-card-cover-placeholder" aria-label="课程封面占位" />
        )}
      </div>
      <div className="activity-card-body">
        <div className="activity-card-title">{courseName}</div>
        <div className="activity-card-price">
          <MoneyText cents={priceCents} originalCents={originalCents} size="medium" />
        </div>
      </div>
      <div className="activity-card-footer" style={{ background: footerColor }}>
        <span className="activity-card-status">{footerLabel}</span>
        {deadlineAt && <ActivityCountdown deadlineAt={deadlineAt} onExpire={onExpire} />}
      </div>
    </Link>
  );
}
