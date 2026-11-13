import { useState } from 'react';
import { Link } from 'react-router';
import type { CourseBrief } from '@/api/types';
import { MoneyText } from './MoneyText';
import './CourseMiniCard.css';

// 精品推荐小卡：左侧封面 + 右侧名称与价格
export function CourseMiniCard({ course }: { course: CourseBrief }) {
  // 封面是否加载失败
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <Link to={`/courses/${course.id}`} className="course-mini-card">
      <div className="course-mini-cover">
        {course.coverUrl && !coverFailed && (
          <img
            src={course.coverUrl}
            alt={course.name ?? '课程封面'}
            onError={() => setCoverFailed(true)}
          />
        )}
      </div>
      <div className="course-mini-info">
        <span className="course-mini-name">{course.name}</span>
        <MoneyText cents={course.saleCents ?? 0} originalCents={course.originalCents} />
      </div>
    </Link>
  );
}
