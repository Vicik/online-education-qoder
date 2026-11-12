import { Card, Typography } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CourseBrief } from '@/api/types';
import { MoneyText } from '@/components/common/MoneyText';
import './CourseCard.css';

// 封面：无地址或加载失败时回退占位块；失败只通知一次父资源重取
function CourseCover({
  url,
  alt,
  onError,
}: {
  url: string | null;
  alt: string;
  onError?: () => void;
}) {
  // 本卡片内是否已回退占位
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return <div style={{ height: 150, background: '#f0f2f5' }} aria-label="课程封面占位" />;
  }

  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      style={{ width: '100%', height: 150, objectFit: 'cover' }}
      onError={() => {
        setFailed(true);
        onError?.();
      }}
    />
  );
}

// 课程卡片：只展示封面、名称、讲师、价格；不展示课程类型与报名人数
export function CourseCard({
  course,
  footer,
  onCoverError,
}: {
  course: CourseBrief;
  footer?: ReactNode;
  onCoverError?: () => void;
}) {
  return (
    <Card
      hoverable
      styles={{ body: { padding: 12 } }}
      cover={
        <Link to={`/courses/${course.id}`} aria-label={course.name}>
          <CourseCover
            url={course.coverUrl ?? null}
            alt={course.name ?? '课程封面'}
            onError={onCoverError}
          />
        </Link>
      }
    >
      <Link to={`/courses/${course.id}`} style={{ display: 'block' }}>
        <Typography.Text strong ellipsis style={{ display: 'block' }}>
          {course.name}
        </Typography.Text>
        <Typography.Text type="secondary" ellipsis style={{ display: 'block', marginBottom: 8 }}>
          {course.instructor ?? '—'}
        </Typography.Text>
        {/* 原价单独下移，售价保持原位 */}
        <div className="course-card-price">
          <MoneyText cents={course.saleCents ?? 0} originalCents={course.originalCents} />
        </div>
      </Link>
      {footer}
    </Card>
  );
}
