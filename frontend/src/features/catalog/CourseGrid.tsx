import { Col, Row, Skeleton } from 'antd';
import type { CourseBrief } from '@/api/types';
import { CourseCard } from './CourseCard';

// 课程网格：自适应 3–4 列（≥240px 一列）
export function CourseGrid({ courses }: { courses: CourseBrief[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 16,
      }}
    >
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} />
      ))}
    </div>
  );
}

// 课程网格骨架屏：首屏加载态
export function CourseGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Row gutter={[16, 16]}>
      {Array.from({ length: count }, (_, index) => (
        <Col key={index} xs={24} sm={12} lg={6}>
          <Skeleton.Image active style={{ width: '100%', height: 150 }} />
          <Skeleton active paragraph={{ rows: 1 }} title={false} />
        </Col>
      ))}
    </Row>
  );
}
