import { Button } from 'antd';
import { ConfirmAction } from '@/components/common/ConfirmAction';
import { useFavoriteToggle } from '@/hooks/useFavorites';

// 收藏按钮：写操作前二次确认，取消不触发
export function FavoriteButton({ courseId }: { courseId: number }) {
  // 收藏态与切换动作
  const { favorited, pending, toggle } = useFavoriteToggle(courseId);

  return (
    <ConfirmAction
      title={favorited ? '取消收藏该课程？' : '收藏该课程？'}
      onConfirm={toggle}
      disabled={pending}
    >
      <Button loading={pending}>{favorited ? '已收藏' : '收藏'}</Button>
    </ConfirmAction>
  );
}
