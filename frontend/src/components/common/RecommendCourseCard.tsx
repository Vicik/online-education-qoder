import { useState } from 'react';
import { Link } from 'react-router';
import type { CourseBrief } from '@/api/types';
import { MoneyText } from './MoneyText';
import './RecommendCourseCard.css';

// 侧栏精品课程卡：封面 + 名称 + 售价，社区与考试侧栏共用
export function RecommendCourseCard({ course }: { course: CourseBrief }) {
  // 封面是否加载失败
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <Link to={`/courses/${course.id}`} className="recommend-card">
      <div className="recommend-card-cover">
        {course.coverUrl && !coverFailed && (
          <img
            src={course.coverUrl}
            alt={course.name ?? '课程封面'}
            onError={() => setCoverFailed(true)}
          />
        )}
      </div>
      <p className="recommend-card-name">{course.name}</p>
      <div className="recommend-card-price">
        <MoneyText
          cents={course.saleCents ?? 0}
          originalCents={course.originalCents}
          size="medium"
        />
      </div>
    </Link>
  );
}
