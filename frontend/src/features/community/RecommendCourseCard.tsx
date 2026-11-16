import { useState } from 'react';
import { Link } from 'react-router';
import type { CourseBrief } from '@/api/types';
import { MoneyText } from '@/components/common/MoneyText';

// 侧栏精品课程卡：封面 + 名称 + 售价
export function RecommendCourseCard({ course }: { course: CourseBrief }) {
  // 封面是否加载失败
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <Link to={`/courses/${course.id}`} className="community-recommend-card">
      <div className="community-recommend-cover">
        {course.coverUrl && !coverFailed && (
          <img
            src={course.coverUrl}
            alt={course.name ?? '课程封面'}
            onError={() => setCoverFailed(true)}
          />
        )}
      </div>
      <p className="community-recommend-name">{course.name}</p>
      <div className="community-recommend-price">
        <MoneyText
          cents={course.saleCents ?? 0}
          originalCents={course.originalCents}
          size="medium"
        />
      </div>
    </Link>
  );
}
