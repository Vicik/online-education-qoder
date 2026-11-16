import { Button } from 'antd';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { getRecommendations } from '@/api/catalog';
import { queryKeys } from '@/api/query-keys';
import { RecommendCourseCard } from '@/components/common/RecommendCourseCard';
import { usePermission } from '@/hooks/usePermission';

// 侧栏精品推荐展示数量
const RECOMMEND_SIZE = 4;

// 社区侧栏：发布入口 + 精品推荐，信息流与详情页共用
export function CommunitySidebar() {
  // 当前用户
  const { user } = usePermission();
  // 路由跳转
  const navigate = useNavigate();
  // 精品推荐查询：与首页、课程详情共享缓存
  const query = useQuery({
    queryKey: queryKeys.homeRecommendations,
    queryFn: getRecommendations,
  });

  // 发帖入口：游客先登录
  const gotoNewPost = () => {
    if (!user) {
      navigate('/login?redirect=%2Fcommunity%2Fnew');
      return;
    }
    navigate('/community/new');
  };

  // 侧栏推荐课程
  const items = (query.data ?? []).slice(0, RECOMMEND_SIZE);

  return (
    <aside className="community-side" aria-label="社区侧栏">
      <Button type="primary" size="large" className="community-publish" onClick={gotoNewPost}>
        发布帖子
      </Button>
      {items.length > 0 && (
        <section className="community-recommend">
          <h2 className="community-recommend-title">精品推荐</h2>
          <div className="community-recommend-list">
            {items.map((item) => (
              <RecommendCourseCard key={item.id} course={item} />
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
