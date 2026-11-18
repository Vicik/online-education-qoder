import { Carousel } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';
import type { CourseBrief } from '@/api/types';
import './HomeBanner.css';

// banner 封面：无地址或加载失败时回退占位块，仅本张降级不影响其他 slide
function BannerCover({ url, alt }: { url: string | null; alt: string }) {
  // 本张是否已回退占位
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div className="home-banner-fallback" aria-label="课程封面占位" role="img" />
    );
  }

  return (
    <img
      className="home-banner-image"
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

// 首页宣传位 banner：循环滚动展示宣传课程封面，点击进入与普通课程一致的详情页
export function HomeBanner({ courses }: { courses: CourseBrief[] }) {
  // 只有 1 门时无需轮播，关闭自动播放与指示点
  const isCarousel = courses.length > 1;

  return (
    <div className="home-banner" role="region" aria-label="首页宣传">
      <Carousel autoplay={isCarousel} dots={isCarousel} infinite={isCarousel}>
        {courses.map((course) => (
          <div key={course.id}>
            <Link to={`/courses/${course.id}`}>
              <BannerCover url={course.coverUrl ?? null} alt={course.name ?? '课程封面'} />
            </Link>
          </div>
        ))}
      </Carousel>
    </div>
  );
}
